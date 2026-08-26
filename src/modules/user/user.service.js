import ApiError from "../../shared/utils/ApiError.js";
import { paginateQuery } from "../../shared/utils/pagination.util.js";
import { containsInsensitive } from "../../shared/utils/text.util.js";
import env from "../../config/env.js";
import { sendEmailSafely } from "../../shared/mail/mailer.js";
import { getFrontendBaseUrl } from "../../config/app.config.js";
import { forgotPasswordTemplate } from "../auth/emails/forgotPassword.template.js";
import { roleCanActOn } from "../auth/rbac/roles.js";
import { revokeAllSessions } from "../auth/auth.service.js";
import Session, { SESSION_REVOKE_REASONS } from "../auth/session.model.js";
import { PASSWORD_RESET_TOKEN_EXPIRES_MINUTES } from "../auth/auth.constants.js";
import User from "./user.model.js";
import {
  ADDRESS_FIELDS,
  DEFAULT_USER_SORT,
  LOGIN_BLOCKING_STATUSES,
  USER_ROLES,
  USER_STATUSES,
} from "./user.constants.js";

/**
 * Applies a partial address patch. Only the fields present in the payload are
 * touched, and an explicit `null` clears one field without wiping the rest.
 * Sending `address: null` clears the whole address.
 */
const applyAddress = (user, address) => {
  if (address === undefined) return;

  if (address === null) {
    user.address = {};
    return;
  }

  const next = { ...user.addressToObject() };
  ADDRESS_FIELDS.forEach((field) => {
    if (address[field] !== undefined) {
      next[field] = address[field] || null;
    }
  });

  user.address = next;
};

/**
 * Guards every administrative write: an actor may only manage accounts that sit
 * strictly below their own role level, and never their own account through the
 * admin endpoints (that is what the self-service profile routes are for).
 */
const assertCanManage = (actor, target) => {
  if (actor._id.equals(target._id)) {
    throw new ApiError(400, "Use your own profile endpoints to manage your account");
  }

  if (!roleCanActOn(actor.role, target.role)) {
    throw new ApiError(403, "You cannot manage an account at or above your own role level");
  }
};

const assertCanAssignRole = (actor, role) => {
  if (!roleCanActOn(actor.role, role)) {
    throw new ApiError(403, "You cannot assign a role at or above your own role level");
  }
};

const findUserOrFail = async (userId) => {
  const user = await User.findById(userId);

  if (!user) {
    throw new ApiError(404, "User not found");
  }

  return user;
};

export const listUsers = async ({
  page,
  limit,
  role,
  status,
  search,
  sort = DEFAULT_USER_SORT,
}) => {
  const filter = {};

  if (role) filter.role = role;
  if (status) filter.status = status;
  if (search) {
    // Escaped so a user-supplied string can never act as a regular expression.
    const pattern = containsInsensitive(search);
    filter.$or = [{ name: pattern }, { email: pattern }, { phone: pattern }];
  }

  const { documents, pagination } = await paginateQuery(User, filter, { page, limit, sort });

  return { users: documents.map((user) => user.toSafeObject()), pagination };
};

export const getUserById = async (userId) => {
  const user = await findUserOrFail(userId);
  return user.toSafeObject();
};

/**
 * Creates a staff/admin account. No password is chosen by the administrator:
 * the new user receives a set-password link, so the credential is only ever
 * known to its owner.
 */
export const createUser = async (actor, { name, email, role, phone, address }) => {
  assertCanAssignRole(actor, role);

  if (await User.exists({ email })) {
    throw new ApiError(409, "An account with this email already exists");
  }

  const user = new User({
    name,
    email,
    // Replaced immediately by the invitation flow below; never communicated.
    password: `${Date.now()}-${Math.random().toString(36).slice(2)}Aa1`,
    role,
    phone: phone || null,
    status: USER_STATUSES.PENDING_VERIFICATION,
    createdBy: actor._id,
  });

  applyAddress(user, address);

  const inviteToken = user.createPasswordResetToken();
  await user.save();

  await sendEmailSafely({
    to: user.email,
    subject: `You have been invited to ${env.app.name}`,
    html: forgotPasswordTemplate({
      name: user.name,
      resetUrl: `${getFrontendBaseUrl()}/reset-password/${inviteToken}`,
      expiresInMinutes: PASSWORD_RESET_TOKEN_EXPIRES_MINUTES,
    }),
  });

  return user.toSafeObject();
};

export const updateUser = async (actor, userId, { name, phone, avatar, address }) => {
  const user = await findUserOrFail(userId);
  assertCanManage(actor, user);

  applyAddress(user, address);

  if (name !== undefined) user.name = name;
  if (phone !== undefined) user.phone = phone;
  if (avatar !== undefined) user.avatar = avatar;

  await user.save();
  return user.toSafeObject();
};

export const changeUserRole = async (actor, userId, { role }) => {
  const user = await findUserOrFail(userId);
  assertCanManage(actor, user);
  assertCanAssignRole(actor, role);

  user.role = role;
  await user.save();

  // The role is baked into issued access tokens, so old sessions must go.
  await revokeAllSessions(user._id, { reason: SESSION_REVOKE_REASONS.REVOKED_BY_ADMIN });

  return user.toSafeObject();
};

export const changeUserStatus = async (actor, userId, { status }) => {
  const user = await findUserOrFail(userId);
  assertCanManage(actor, user);

  user.status = status;
  if (status === USER_STATUSES.ACTIVE) {
    await user.resetLoginAttempts();
  }
  await user.save();

  if (LOGIN_BLOCKING_STATUSES.includes(status)) {
    await revokeAllSessions(user._id, { reason: SESSION_REVOKE_REASONS.REVOKED_BY_ADMIN });
  }

  return user.toSafeObject();
};

/** Per-user permission overrides on top of the role matrix. */
export const changeUserPermissions = async (actor, userId, { extraPermissions, deniedPermissions }) => {
  const user = await findUserOrFail(userId);
  assertCanManage(actor, user);

  // An actor can only delegate permissions they hold themselves.
  const notDelegatable = (extraPermissions || []).filter(
    (permission) => !actor.hasPermission(permission)
  );

  if (notDelegatable.length > 0) {
    throw new ApiError(403, `You cannot grant permissions you do not hold: ${notDelegatable.join(", ")}`);
  }

  if (extraPermissions !== undefined) user.extraPermissions = extraPermissions;
  if (deniedPermissions !== undefined) user.deniedPermissions = deniedPermissions;

  await user.save();
  return user.toSafeObject();
};

/**
 * Deactivation rather than deletion keeps reservations, payments and audit
 * history intact. Hard deletes are reserved for the super admin.
 */
export const deactivateUser = async (actor, userId) => {
  const user = await findUserOrFail(userId);
  assertCanManage(actor, user);

  user.status = USER_STATUSES.INACTIVE;
  await user.save();
  await revokeAllSessions(user._id, { reason: SESSION_REVOKE_REASONS.REVOKED_BY_ADMIN });

  return user.toSafeObject();
};

/**
 * Permanent, irreversible removal. Deliberately narrow:
 *
 *  - super admin only, on top of the `user:delete` permission;
 *  - never the actor's own account, and never one at or above their level;
 *  - the caller must echo back the account's email address.
 *
 * When the reservation and payment modules exist, this is where a
 * "the account has history, deactivate it instead" check belongs - the record
 * has to survive for those documents to keep meaning.
 */
export const deleteUser = async (actor, userId, { confirmEmail }) => {
  const user = await findUserOrFail(userId);
  assertCanManage(actor, user);

  if (actor.role !== USER_ROLES.SUPER_ADMIN) {
    throw new ApiError(403, "Only a super admin can permanently delete an account");
  }

  if (String(confirmEmail).trim().toLowerCase() !== user.email) {
    throw new ApiError(400, "The confirmation email address does not match this account");
  }

  const deleted = user.toSafeObject();

  // Sessions are removed outright rather than revoked: there is no account left
  // for them to point at.
  await Session.deleteMany({ user: user._id });
  await user.deleteOne();

  return { user: deleted, deleted: true };
};

export const revokeUserSessions = async (actor, userId) => {
  const user = await findUserOrFail(userId);
  assertCanManage(actor, user);

  return revokeAllSessions(user._id, { reason: SESSION_REVOKE_REASONS.REVOKED_BY_ADMIN });
};
