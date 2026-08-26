# MongoDB setup for the auth module

The API talks to MongoDB through Mongoose. You do **not** create collections,
fields or indexes by hand - Mongoose creates the `users` and `sessions`
collections and their indexes on first use. What you must do is give the API a
working connection string and create the first super admin.

---

## 1. Fix the connection string

The current `MONGO_URI` in `hellolobby-backend/.env` fails with
`bad auth : authentication failed`, so the database password is wrong or is still
a placeholder.

In MongoDB Atlas:

1. **Database Access** → find the user `savandikodithuwakku_db_user` →
   **Edit** → **Edit Password** → *Autogenerate Secure Password* → **Copy** →
   **Update User**.
2. **Network Access** → **Add IP Address** → *Add Current IP Address*
   (or `0.0.0.0/0` while developing) → **Confirm**.
3. Put the copied password into `.env`:

```
MONGO_URI=mongodb+srv://savandikodithuwakku_db_user:<PASSWORD>@hellolobby-cluster.xzkummv.mongodb.net/hellolobbyDB?retryWrites=true&w=majority
```

If the password contains `@ : / ? # [ ] %`, URL-encode it
(`@` → `%40`, `#` → `%23`, `%` → `%25`, …). The simplest fix is to regenerate a
password without special characters.

The database name (`hellolobbyDB`) is the segment after the host. Atlas creates
it automatically the first time a document is written - there is nothing to
create in the UI.

Verify the connection:

```bash
cd hellolobby-backend
npm run dev
```

Expect: `MongoDB connected: <host>/hellolobbyDB`.

---

## 2. Set the remaining environment variables

Compare your `.env` against `.env.example`. The ones that matter for auth:

| Variable | Why |
|---|---|
| `JWT_SECRET` | Signs access tokens. Long random string. |
| `JWT_REFRESH_SECRET` | Signs refresh tokens. **Must differ** from `JWT_SECRET`. |
| `FRONTEND_URL` | CORS origin **and** the base of email links. |
| `SMTP_*` | Email delivery. Leave blank in development: verification and reset links are printed to the server console instead. |
| `SEED_SUPER_ADMIN_EMAIL` / `SEED_SUPER_ADMIN_PASSWORD` | Used once, by the seed script below. |

Generate a secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

---

## 3. Create the first super admin

No public endpoint can create a privileged account - registration always produces
a `customer`. The first super admin comes from a one-off script.

```bash
# .env
SEED_SUPER_ADMIN_NAME=Super Admin
SEED_SUPER_ADMIN_EMAIL=you@example.com
SEED_SUPER_ADMIN_PASSWORD=ChangeMe123
```

```bash
cd hellolobby-backend
npm run seed:super-admin
```

The script is idempotent: run it twice and the second run only reports that the
account already exists. Sign in, change the password, then blank out
`SEED_SUPER_ADMIN_PASSWORD`.

From then on, staff and admin accounts are created through
`POST /api/v1/users`, which emails an invitation link instead of a password.

---

## 4. What the module stores

### `users`

| Field | Purpose |
|---|---|
| `name`, `email` (unique), `phone`, `avatar` | Profile |
| `password` | bcrypt hash, never selected by default |
| `role` | `super_admin` / `admin` / `staff` / `customer` |
| `status` | `pending_verification` / `active` / `inactive` / `suspended` |
| `extraPermissions`, `deniedPermissions` | Per-user overrides of the role matrix |
| `emailVerified`, `emailVerificationToken`, `emailVerificationExpires` | Email verification |
| `passwordResetToken`, `passwordResetExpires`, `passwordChangedAt` | Password reset |
| `failedLoginAttempts`, `lockedUntil` | Brute-force lockout |
| `lastLoginAt`, `lastLoginIp`, `createdBy` | Audit trail (feeds the user report later) |

### `sessions`

One document per signed-in device: hashed refresh token, device label, IP,
`rememberMe`, `lastUsedAt`, `expiresAt`, `revokedAt`, `revokedReason`.

Indexes created automatically: unique `email`; `role`; `status`; unique
`refreshTokenHash`; `user + revokedAt`; and a **TTL index on `expiresAt`** that
lets MongoDB delete expired sessions on its own - no cleanup job required.

> `autoIndex` is enabled in development only. When deploying to production,
> either run once with `NODE_ENV=development` against the production database or
> call `Model.syncIndexes()` during your deployment step, so the indexes exist.

---

## 5. Verifying the flows end to end

With `npm run dev` running and SMTP left blank:

1. `POST /api/v1/auth/register` → the verification link appears in the server
   console as `[DEV EMAIL] Link: …`.
2. Open that link in the app (or `POST /api/v1/auth/verify-email/:token`) →
   status becomes `active`.
3. `POST /api/v1/auth/login` → returns an access token and sets the
   `refreshToken` cookie.
4. `GET /api/v1/auth/me` with `Authorization: Bearer <accessToken>`.
5. `GET /api/v1/auth/sessions` → the device you just signed in from.

In Postman, enable **Send cookies** so the refresh cookie is stored, and note
that the refresh token is intentionally absent from every response body.
