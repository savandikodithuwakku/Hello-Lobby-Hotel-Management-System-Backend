import crypto from "crypto";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import env from "../../config/env.js";
import { hashToken } from "../../shared/utils/crypto.util.js";
import { resolvePermissions } from "../auth/rbac/roles.js";
import { PERMISSION_VALUES } from "../auth/rbac/permissions.js";
import {
  USER_ROLE_VALUES,
  USER_ROLES,
  USER_STATUS_VALUES,
  USER_STATUSES,
} from "./user.constants.js";

/**
 * Postal address. Embedded rather than referenced: an address has no life of
 * its own, is always read together with its user, and is never queried across
 * users. `_id: false` keeps the stored document flat.
 */
const addressSchema = new mongoose.Schema(
  {
    line1: { type: String, trim: true, maxlength: 120, default: null },
    line2: { type: String, trim: true, maxlength: 120, default: null },
    city: { type: String, trim: true, maxlength: 80, default: null },
    state: { type: String, trim: true, maxlength: 80, default: null },
    postalCode: { type: String, trim: true, maxlength: 20, default: null },
    country: { type: String, trim: true, maxlength: 80, default: null },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      minlength: [2, "Name must be at least 2 characters"],
      maxlength: [80, "Name must not exceed 80 characters"],
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [8, "Password must be at least 8 characters"],
      select: false,
    },
    role: {
      type: String,
      enum: USER_ROLE_VALUES,
      default: USER_ROLES.CUSTOMER,
      index: true,
    },
    status: {
      type: String,
      enum: USER_STATUS_VALUES,
      default: USER_STATUSES.PENDING_VERIFICATION,
      index: true,
    },
    /** Permissions granted on top of whatever the role already allows. */
    extraPermissions: {
      type: [{ type: String, enum: PERMISSION_VALUES }],
      default: [],
    },
    /** Permissions revoked from this user even though the role grants them. */
    deniedPermissions: {
      type: [{ type: String, enum: PERMISSION_VALUES }],
      default: [],
    },
    phone: {
      type: String,
      trim: true,
      default: null,
    },
    address: {
      type: addressSchema,
      default: () => ({}),
    },
    avatar: {
      type: String,
      default: null,
    },
    emailVerified: {
      type: Boolean,
      default: false,
    },
    emailVerificationToken: {
      type: String,
      select: false,
      default: null,
    },
    emailVerificationExpires: {
      type: Date,
      select: false,
      default: null,
    },
    passwordChangedAt: {
      type: Date,
      default: null,
    },
    passwordResetToken: {
      type: String,
      select: false,
      default: null,
    },
    passwordResetExpires: {
      type: Date,
      select: false,
      default: null,
    },
    failedLoginAttempts: {
      type: Number,
      default: 0,
      select: false,
    },
    lockedUntil: {
      type: Date,
      default: null,
      select: false,
    },
    lastLoginAt: {
      type: Date,
      default: null,
    },
    lastLoginIp: {
      type: String,
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

userSchema.virtual("isLocked").get(function isLocked() {
  return Boolean(this.lockedUntil && this.lockedUntil.getTime() > Date.now());
});

userSchema.virtual("permissions").get(function permissions() {
  return resolvePermissions({
    role: this.role,
    extraPermissions: this.extraPermissions,
    deniedPermissions: this.deniedPermissions,
  });
});

// Mongoose 9 drives async middleware by the returned promise only — no `next`.
userSchema.pre("save", async function hashPassword() {
  if (!this.isModified("password")) {
    return;
  }

  this.password = await bcrypt.hash(this.password, env.security.bcryptSaltRounds);

  if (!this.isNew) {
    // Backdate a second so a token issued in the same tick is not falsely rejected.
    this.passwordChangedAt = new Date(Date.now() - 1000);
  }
});

userSchema.methods.comparePassword = function comparePassword(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.hasPermission = function hasPermission(permission) {
  return this.permissions.includes(permission);
};

/**
 * Creates a single-use token: the plain value is emailed to the user while only
 * its SHA-256 digest is persisted, so a database leak cannot be replayed.
 */
userSchema.methods.createPasswordResetToken = function createPasswordResetToken() {
  const resetToken = crypto.randomBytes(32).toString("hex");

  this.passwordResetToken = hashToken(resetToken);
  this.passwordResetExpires = new Date(
    Date.now() + env.security.passwordResetTokenMinutes * 60 * 1000
  );

  return resetToken;
};

userSchema.methods.createEmailVerificationToken = function createEmailVerificationToken() {
  const verificationToken = crypto.randomBytes(32).toString("hex");

  this.emailVerificationToken = hashToken(verificationToken);
  this.emailVerificationExpires = new Date(
    Date.now() + env.security.emailVerificationTokenHours * 60 * 60 * 1000
  );

  return verificationToken;
};

userSchema.methods.clearPasswordResetToken = function clearPasswordResetToken() {
  this.passwordResetToken = null;
  this.passwordResetExpires = null;
};

userSchema.methods.clearEmailVerificationToken = function clearEmailVerificationToken() {
  this.emailVerificationToken = null;
  this.emailVerificationExpires = null;
};

userSchema.methods.hasPasswordChangedAfter = function hasPasswordChangedAfter(issuedAtInSeconds) {
  if (!this.passwordChangedAt) {
    return false;
  }

  return Math.floor(this.passwordChangedAt.getTime() / 1000) > issuedAtInSeconds;
};

/**
 * Records a failed login and locks the account once the threshold is reached.
 * Uses an atomic update so parallel attempts cannot race each other.
 */
userSchema.methods.registerFailedLogin = async function registerFailedLogin() {
  const attempts = (this.failedLoginAttempts || 0) + 1;
  const shouldLock = attempts >= env.security.maxFailedLoginAttempts;

  const update = shouldLock
    ? {
        failedLoginAttempts: attempts,
        lockedUntil: new Date(Date.now() + env.security.accountLockMinutes * 60 * 1000),
      }
    : { failedLoginAttempts: attempts };

  await this.constructor.updateOne({ _id: this._id }, { $set: update });
  return shouldLock;
};

userSchema.methods.resetLoginAttempts = function resetLoginAttempts() {
  return this.constructor.updateOne(
    { _id: this._id },
    { $set: { failedLoginAttempts: 0, lockedUntil: null } }
  );
};

/**
 * The address is spelled out field by field rather than returned as a raw
 * subdocument, so the API shape stays identical whether or not an address has
 * ever been saved.
 */
userSchema.methods.addressToObject = function addressToObject() {
  return {
    line1: this.address?.line1 ?? null,
    line2: this.address?.line2 ?? null,
    city: this.address?.city ?? null,
    state: this.address?.state ?? null,
    postalCode: this.address?.postalCode ?? null,
    country: this.address?.country ?? null,
  };
};

/** The only shape of a user that is ever sent over the wire. */
userSchema.methods.toSafeObject = function toSafeObject() {
  return {
    id: this._id.toString(),
    name: this.name,
    email: this.email,
    role: this.role,
    status: this.status,
    permissions: this.permissions,
    phone: this.phone,
    address: this.addressToObject(),
    avatar: this.avatar,
    emailVerified: this.emailVerified,
    lastLoginAt: this.lastLoginAt,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

export const User = mongoose.model("User", userSchema);
export default User;
