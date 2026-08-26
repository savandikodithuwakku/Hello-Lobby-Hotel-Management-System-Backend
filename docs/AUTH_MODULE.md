# Authentication & Authorization Module

A self-contained, reusable identity module: JWT access tokens, rotating refresh
tokens in HTTP-only cookies, email verification, password reset, device/session
management and permission-based RBAC.

To reuse it in another project, copy `src/config`, `src/shared`,
`src/modules/auth`, `src/modules/user`, provide a `.env`
based on `.env.example`, and edit only two files:
`src/modules/auth/rbac/permissions.js` (what exists) and
`src/modules/auth/rbac/roles.js` (who gets what).

---

## 1. Folder structure

Files are grouped by the **module that owns them**, not by technical type.
Everything the auth module needs - its middleware, its RBAC matrix, its tokens,
cookies and emails - lives under `src/modules/auth`, so the folder can be copied
into another project as one unit.

```
src/
├── config/                       Application-wide configuration
│   ├── env.js                    Validated configuration; the only reader of process.env
│   ├── database.js               Mongoose connection lifecycle
│   ├── mail.js                   Memoised SMTP transport
│   └── app.config.js             API prefix, CORS origins, frontend base URL
├── shared/                       Cross-module building blocks (no business rules)
│   ├── middleware/
│   │   ├── rateLimit.middleware.js
│   │   ├── validate.middleware.js
│   │   ├── error.middleware.js
│   │   └── notFound.middleware.js
│   ├── utils/                    ApiError, ApiResponse, asyncHandler, crypto, request
│   └── mail/
│       ├── mailer.js             sendEmail / sendEmailSafely
│       └── templates/layout.template.js   Branded shell every email is built on
├── modules/                      Feature modules
│   ├── index.js                  Single mount point for every feature module
│   ├── auth/
│   │   ├── auth.routes.js        HTTP surface
│   │   ├── auth.controller.js    Request/response only
│   │   ├── auth.service.js       Business rules (no req/res in here)
│   │   ├── auth.validation.js    express-validator schemas
│   │   ├── auth.constants.js     User-facing messages
│   │   ├── auth.middleware.js    authenticate / optionalAuthenticate
│   │   ├── session.model.js      One document per logged-in device
│   │   ├── rbac/
│   │   │   ├── permissions.js    Permission registry (single source of truth)
│   │   │   ├── roles.js          Role → permission matrix + role hierarchy
│   │   │   ├── rbac.middleware.js  requirePermission, authorizeRoles, self-or-permission
│   │   │   └── index.js          Public surface of the RBAC layer
│   │   ├── utils/                token, cookie and password helpers
│   │   └── emails/               Verification, welcome, reset and changed-password emails
│   └── user/
│       ├── user.routes.js
│       ├── user.controller.js
│       ├── user.service.js       Administrative user management
│       ├── user.validation.js
│       ├── user.constants.js     Roles & statuses
│       └── user.model.js         Schema, password hashing, token helpers
├── scripts/                      One-off operational scripts (seedSuperAdmin, testEmail)
├── app.js                        Express wiring
└── server.js                     Boot, env validation, graceful shutdown
```

The layering rule: **routes → controller → service → model**. Controllers never
contain business rules, services never touch `req`/`res`. That keeps the service
layer callable from scripts, jobs and tests.

---

## 2. Token strategy

| Token | Lifetime | Stored where | Purpose |
|---|---|---|---|
| Access token (JWT) | 15 min | Client memory only | Sent as `Authorization: Bearer …` |
| Refresh token (JWT) | 1 day, or 30 days with "remember me" | HTTP-only, Secure, SameSite cookie | Obtains a new access token |

- The access token is **never** written to `localStorage`; an XSS bug therefore
  cannot steal a long-lived credential.
- The refresh token is invisible to JavaScript entirely.
- Only the SHA-256 **digest** of a refresh token is stored in the `sessions`
  collection, so a database dump cannot be replayed against the API.
- Access and refresh tokens are signed with **different secrets** and carry a
  `type` claim, so neither can be used in the other's place.

### Refresh-token rotation and reuse detection

Every `POST /auth/refresh` retires the presented session and issues a fresh one.
If a token that was already rotated is presented again, that means a copy leaked,
so **every session of that user is revoked immediately** and the client must sign
in again.

---

## 3. Password & account security

- Hashing: **bcrypt**, cost factor 12 (`BCRYPT_SALT_ROUNDS`).
- Policy: min 8 characters with upper case, lower case and a digit
  (`src/modules/auth/utils/password.util.js` - the single place the rule is defined).
- Failed sign-ins increment a counter; 5 failures lock the account for 15 minutes.
- Password reset and email-verification tokens are 32 random bytes, emailed in
  plain text but stored hashed, single-use, and time-limited.
- `passwordChangedAt` invalidates every access token issued before a change.
- Changing or resetting a password revokes all sessions on all devices.
- `forgot-password` and `resend-verification` always return the same message
  whether or not the address exists (no account enumeration).
- Rate limiting is applied per IP **and** per submitted email address.

---

## 4. Roles and permissions

Four roles, ordered by level: `super_admin` (40) > `admin` (30) > `staff` (20) >
`customer` (10).

Access is checked against **permissions**, not role names. Roles are just named
bundles of permissions, defined in `src/modules/auth/rbac/roles.js`:

```js
router.post(
  "/rooms",
  authenticate,
  requirePermission(PERMISSIONS.ROOM_CREATE),
  createRoom
);
```

Effective permissions are computed as:

```
role permissions  +  user.extraPermissions  −  user.deniedPermissions
```

so one staff member can be granted a single extra capability without inventing a
new role. `super_admin` automatically holds every permission in the registry.

Two escalation guards are always applied:

1. An actor can only manage accounts **strictly below** their own role level.
2. An actor can only grant permissions they hold themselves.

Available middleware (`src/modules/auth/rbac/rbac.middleware.js`):

| Middleware | Meaning |
|---|---|
| `authorizeRoles(...roles)` | Coarse role gate |
| `requirePermission(...perms)` | Holds **at least one** of them |
| `requireAllPermissions(...perms)` | Holds **all** of them |
| `requireSelfOrPermission(perm, param)` | Own record, or the permission |
| `requireHigherRoleThanTarget(fn)` | Blocks privilege escalation |

---

## 5. API reference

Base URL: `http://localhost:5000/api/v1`. All responses use
`{ success, message, data }`; errors use `{ success, message, errors }`.

### Public

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/auth/register` | name, email, password, confirmPassword, phone? | Creates a **customer**, sends verification email |
| POST | `/auth/verify-email/:token` | – | Activates the account |
| POST | `/auth/resend-verification` | email | Always answers the same |
| POST | `/auth/login` | email, password, rememberMe? | Sets the refresh cookie, returns the access token |
| POST | `/auth/refresh` | – (cookie) | Rotates the session |
| POST | `/auth/logout` | – (cookie) | Works with an expired access token |
| POST | `/auth/forgot-password` | email | Always answers the same |
| POST | `/auth/reset-password/:token` | password, confirmPassword | Revokes all sessions |

### Authenticated (`Authorization: Bearer <accessToken>`)

| Method | Path | Notes |
|---|---|---|
| GET | `/auth/me` | Current profile with effective permissions |
| PATCH | `/auth/me` | name, phone, avatar |
| PATCH | `/auth/change-password` | currentPassword, newPassword, confirmNewPassword |
| POST | `/auth/logout-all` | Sign out every device |
| GET | `/auth/sessions` | Active devices, current one flagged |
| DELETE | `/auth/sessions/:sessionId` | Revoke one device |
| GET | `/auth/permissions` | Role → permission matrix for the UI |

### Administration (`/users`, permission-gated)

| Method | Path | Required permission |
|---|---|---|
| GET | `/users` | `user:read` (supports page, limit, role, status, search, sort) |
| POST | `/users` | `user:create` (sends a set-password invitation) |
| GET | `/users/:id` | `user:read` |
| PATCH | `/users/:id` | `user:update` |
| PATCH | `/users/:id/role` | `user:manage_role` (super admin only by default) |
| PATCH | `/users/:id/status` | `user:manage_status` |
| PATCH | `/users/:id/permissions` | `user:manage_role` |
| DELETE | `/users/:id` | `user:delete` or `user:manage_status` (deactivates) |
| DELETE | `/users/:id/sessions` | `session:revoke_any` |

Accounts are **deactivated, never deleted**, so reservations, payments and audit
history stay intact.

---

## 6. Account statuses

| Status | Meaning |
|---|---|
| `pending_verification` | Registered, email not confirmed. Cannot sign in. |
| `active` | Normal access. |
| `inactive` | Deactivated by an administrator. Sessions revoked. |
| `suspended` | Blocked for policy reasons. Sessions revoked. |

---

## 7. Extending it with a new feature module

1. Add the permissions to `rbac/permissions.js`.
2. Grant them to roles in `rbac/roles.js`.
3. Create `src/modules/<feature>/` with `model / service / controller /
   validation / routes`.
4. Guard the routes with `authenticate` + `requirePermission(...)`.
5. Mount it with one line in `src/modules/index.js`.
