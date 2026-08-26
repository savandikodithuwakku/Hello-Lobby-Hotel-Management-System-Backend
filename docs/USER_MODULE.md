# User Management Module

Administrative management of accounts: create, read, update, deactivate and
delete users, plus role, status and permission changes. It builds directly on
the [authentication module](AUTH_MODULE.md) — every route below is
authenticated, and every route is gated by an explicit permission rather than a
hard-coded role list.

---

## 1. Folder structure

```
src/modules/user/
├── user.routes.js       The HTTP surface, one permission per route
├── user.controller.js   Request in, response out
├── user.service.js      All the rules; never sees req/res
├── user.validation.js   express-validator schemas
├── user.constants.js    Roles, statuses, sort options, page sizes
└── user.model.js        Schema, password hashing, token helpers, address
```

---

## 2. What a user record holds

| Field | Notes |
|---|---|
| `name` | 2–80 characters |
| `email` | Unique, lower-cased, used to sign in |
| `phone` | Optional |
| `address` | Embedded: `line1`, `line2`, `city`, `state`, `postalCode`, `country` |
| `role` | `super_admin` / `admin` / `staff` / `customer` |
| `status` | `active` / `inactive` / `suspended` / `pending_verification` |
| `permissions` | Derived: role defaults + `extraPermissions` − `deniedPermissions` |
| `emailVerified` | Set by the verification flow |
| `lastLoginAt`, `lastLoginIp` | Written on every successful sign-in |
| `createdAt`, `updatedAt` | Mongoose timestamps |
| `createdBy` | The administrator who invited this account, when applicable |

The address is **embedded rather than referenced**: it has no life of its own,
is always read together with its user, and is never queried across users.
`toSafeObject()` spells every address field out, so the API returns the same
shape whether or not an address was ever saved.

---

## 3. Endpoints

All paths are relative to `/api/v1/users` and all require a valid access token.

| Method | Path | Permission | Purpose |
|---|---|---|---|
| `GET` | `/` | `user:read` | List with search, filters, sorting and pagination |
| `POST` | `/` | `user:create` | Invite a new account |
| `GET` | `/:id` | `user:read` | One account |
| `PATCH` | `/:id` | `user:update` | Name, phone, avatar, address |
| `PATCH` | `/:id/role` | `user:manage_role` | Change role |
| `PATCH` | `/:id/status` | `user:manage_status` | Activate, deactivate, suspend |
| `PATCH` | `/:id/permissions` | `user:manage_role` | Per-user grants and denials |
| `DELETE` | `/:id` | `user:delete` **or** `user:manage_status` | Deactivate (soft) |
| `DELETE` | `/:id/permanent` | `user:delete` | Permanent delete (super admin) |
| `DELETE` | `/:id/sessions` | `session:revoke_any` | Sign the user out everywhere |

### Listing

`GET /users?search=&role=&status=&sort=&page=&limit=`

- **search** matches name, email or phone, case-insensitively. The term is
  regex-escaped, so a user-supplied string can never behave as a pattern.
- **sort** is restricted to a fixed list in `user.constants.js`; an arbitrary
  field name can never reach `Query.sort()`.
- **limit** is capped at 100 regardless of what the client asks for.
- The response carries `{ users, pagination: { page, limit, total, totalPages } }`.

---

## 4. The guard rails

Three rules are enforced in the service layer, so they hold no matter which
route reaches them.

**The role ladder.** `assertCanManage()` requires the actor's role level to be
*strictly above* the target's. An admin cannot edit, promote, suspend or delete
another admin, and nobody can act on a super admin except a higher level, which
does not exist.

**No self-administration.** An actor cannot use the admin endpoints on their own
account. Self-service lives on `/auth/me` and `/auth/change-password`, which
require the current password. This stops an admin quietly lifting their own
role.

**You cannot delegate what you do not hold.** `changeUserPermissions()` rejects
any `extraPermissions` entry the actor does not personally hold.

---

## 5. Account lifecycle

### Invitation, not password-setting

`POST /users` never accepts a password. The account is created with a throwaway
value, immediately issued a single-use set-password token, and emailed an
invitation link. The credential is therefore only ever known to its owner — an
administrator can create an account they cannot sign in to.

The new account starts as `pending_verification` and becomes `active` when the
invitation is completed.

### Changing a role signs the user out

The role is baked into every issued access token, so `changeUserRole()` revokes
all of that user's sessions with reason `revoked_by_admin`. Without this, a
demoted user would keep an elevated token for up to fifteen minutes.

### Deactivate vs delete

**Deactivate** (`DELETE /users/:id`) sets the status to `inactive` and ends
every session. The record survives, which matters because reservations and
payments will point at it. This is the normal way to remove someone.

**Permanent delete** (`DELETE /users/:id/permanent`) is deliberately hard to
reach:

- `user:delete` is granted only to the super admin in the role matrix, and the
  service asserts the role again rather than trusting the matrix alone;
- the caller must send the account's own email address as `confirmEmail`;
- the role ladder and the no-self-administration rule still apply.

Sessions are deleted outright rather than revoked — there is no account left for
them to point at.

> **When Reservations and Payments exist**, `deleteUser()` is where a
> "this account has history, deactivate it instead" check belongs.

---

## 6. Frontend

`hellolobby-frontend/src/features/users/`

| Screen | Route | Gate |
|---|---|---|
| User list | `/users` | `user:read` |
| Add user | `/users/new` | `user:create` |
| User detail | `/users/:id` | `user:read` |

The list keeps its filters **in the URL**, so a filtered view can be
bookmarked, shared and survives the back button. The search box is debounced;
the selects apply immediately.

The detail screen holds the profile (inline edit), the access controls (role and
status), a danger zone (sign out all devices, deactivate, delete) and the
effective permission list. Every destructive action goes through an inline
confirmation, and a permanent delete requires the operator to type the email
address back.

Controls are hidden when the signed-in user lacks the permission or the role
level to use them — a convenience only. The API re-checks everything.

---

## 7. Not built yet

Reservation history and customer spending appear on the user detail screen as
placeholders. They need data that only the Reservations and Payments modules
produce, and are wired up when those modules are built.
