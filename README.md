# HelloLobby Backend

Express 5 + MongoDB API for the HelloLobby hotel management system.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start with file watching |
| `npm start` | Start the server |
| `npm run seed:super-admin` | Create the first super admin account |

## Documentation

- [Authentication & Authorization module](docs/AUTH_MODULE.md) - architecture, token
  strategy, RBAC model and the full API reference.
- [User management module](docs/USER_MODULE.md) - administrative account
  management, the role ladder and the deactivate/delete policy.
- [MongoDB setup](docs/MONGODB_SETUP.md) - connection string, environment
  variables, seeding and what the module stores.

## Configuration

Copy `.env.example` to `.env` and fill in the values. `src/config/env.js` is the
only module that reads `process.env`; it validates the configuration at boot and
refuses to start with missing or unsafe values in production.
