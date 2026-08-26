/**
 * Creates the first super admin account.
 *
 * The system has no public route that can create a privileged user, so this
 * script is the documented bootstrap path:
 *
 *   npm run seed:super-admin
 *
 * It reads SEED_SUPER_ADMIN_EMAIL / SEED_SUPER_ADMIN_PASSWORD from .env and is
 * idempotent: running it again only reports that the account already exists.
 */
import env, { assertEnvIsValid } from "../config/env.js";
import connectDB, { disconnectDB } from "../config/database.js";
import User from "../modules/user/user.model.js";
import { USER_ROLES, USER_STATUSES } from "../modules/user/user.constants.js";
import { isStrongPassword, PASSWORD_RULE_MESSAGE } from "../modules/auth/utils/password.util.js";

const run = async () => {
  assertEnvIsValid();

  const { superAdminEmail: email, superAdminPassword: password, superAdminName: name } = env.seed;

  if (!email || !password) {
    throw new Error("SEED_SUPER_ADMIN_EMAIL and SEED_SUPER_ADMIN_PASSWORD must be set in .env");
  }

  if (!isStrongPassword(password)) {
    throw new Error(`SEED_SUPER_ADMIN_PASSWORD is too weak. ${PASSWORD_RULE_MESSAGE}`);
  }

  await connectDB();

  const normalizedEmail = email.toLowerCase().trim();
  const existing = await User.findOne({ email: normalizedEmail });

  if (existing) {
    console.log(`Super admin already exists: ${existing.email} (role: ${existing.role})`);
    return;
  }

  const superAdmin = await User.create({
    name,
    email: normalizedEmail,
    password,
    role: USER_ROLES.SUPER_ADMIN,
    status: USER_STATUSES.ACTIVE,
    emailVerified: true,
  });

  console.log(`Super admin created: ${superAdmin.email}`);
  console.log("Sign in and change this password immediately.");
};

run()
  .catch((error) => {
    console.error("Seeding failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDB();
  });
