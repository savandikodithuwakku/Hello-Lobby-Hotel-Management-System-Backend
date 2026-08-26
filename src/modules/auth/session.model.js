import mongoose from "mongoose";

export const SESSION_REVOKE_REASONS = Object.freeze({
  LOGOUT: "logout",
  ROTATED: "rotated",
  REVOKED_BY_USER: "revoked_by_user",
  REVOKED_BY_ADMIN: "revoked_by_admin",
  PASSWORD_CHANGED: "password_changed",
  REUSE_DETECTED: "reuse_detected",
});

/**
 * One document per logged-in device. Refresh tokens are never stored in plain
 * text - only their SHA-256 digest is kept, so database access alone cannot be
 * used to impersonate a user.
 */
const sessionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    refreshTokenHash: {
      type: String,
      required: true,
      unique: true,
      select: false,
    },
    device: {
      type: String,
      default: "Unknown device",
    },
    userAgent: {
      type: String,
      default: null,
    },
    ipAddress: {
      type: String,
      default: null,
    },
    rememberMe: {
      type: Boolean,
      default: false,
    },
    lastUsedAt: {
      type: Date,
      default: Date.now,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    revokedAt: {
      type: Date,
      default: null,
    },
    revokedReason: {
      type: String,
      enum: [...Object.values(SESSION_REVOKE_REASONS), null],
      default: null,
    },
  },
  { timestamps: true }
);

// MongoDB removes expired sessions automatically. Rotated sessions are kept
// until expiry so that refresh-token reuse can still be detected.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
sessionSchema.index({ user: 1, revokedAt: 1 });

sessionSchema.methods.isActive = function isActive() {
  return !this.revokedAt && this.expiresAt.getTime() > Date.now();
};

sessionSchema.methods.toSafeObject = function toSafeObject(currentSessionId = null) {
  return {
    id: this._id.toString(),
    device: this.device,
    ipAddress: this.ipAddress,
    rememberMe: this.rememberMe,
    lastUsedAt: this.lastUsedAt,
    createdAt: this.createdAt,
    expiresAt: this.expiresAt,
    current: currentSessionId ? this._id.toString() === String(currentSessionId) : false,
  };
};

export const Session = mongoose.model("Session", sessionSchema);
export default Session;
