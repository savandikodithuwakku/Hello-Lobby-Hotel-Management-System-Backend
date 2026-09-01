import mongoose from "mongoose";
import env from "../../config/env.js";
import {
  AUDIT_ACTION_VALUES,
  AUDIT_ENTITY_VALUES,
  AUDIT_OUTCOMES,
  AUDIT_OUTCOME_VALUES,
  POLICY,
} from "./audit.constants.js";

/**
 * One recorded change.
 *
 * The value is stored as text rather than in its original type on purpose: a
 * log entry has to still make sense in a year, after the field it describes has
 * been renamed, retyped or removed from the schema altogether. Keeping the
 * before and after as plain text means an old entry can always be read back.
 */
const changeSchema = new mongoose.Schema(
  {
    field: { type: String, required: true, trim: true },
    from: { type: String, default: null },
    to: { type: String, default: null },
  },
  { _id: false }
);

/**
 * An entry in the audit log.
 *
 * Append-only. Nothing in the application updates or deletes an entry, and the
 * hooks below make that a rule rather than a convention - a log that can be
 * quietly edited is worth very little when it matters.
 *
 * Who did it is stored twice: a reference to the account, and a copy of their
 * name and role as they were at the time. The reference lets you follow a
 * person's whole trail; the copy means the entry still reads correctly after
 * the account is deleted or promoted, which is exactly the situation where the
 * log is being read in the first place.
 */
const auditLogSchema = new mongoose.Schema(
  {
    action: {
      type: String,
      enum: AUDIT_ACTION_VALUES,
      required: [true, "An audit entry needs an action"],
      index: true,
    },
    entity: {
      type: {
        type: String,
        enum: AUDIT_ENTITY_VALUES,
        required: true,
      },
      /** Null for an action with no record behind it, such as a failed sign-in
       * for an address that does not exist. */
      id: { type: mongoose.Schema.Types.ObjectId, default: null },
      /** How a person would refer to it: a booking reference, a room number,
       * an email address. Stored so the log reads without a join. */
      label: {
        type: String,
        trim: true,
        maxlength: [POLICY.LABEL_MAX, "Label is too long"],
        default: "",
      },
    },
    actor: {
      user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
      /** Copies, taken at the time. See the note above. */
      name: { type: String, trim: true, default: "" },
      email: { type: String, trim: true, lowercase: true, default: "" },
      role: { type: String, trim: true, default: "" },
    },
    outcome: {
      type: String,
      enum: AUDIT_OUTCOME_VALUES,
      default: AUDIT_OUTCOMES.SUCCESS,
      index: true,
    },
    /** One sentence a person can read without knowing the field names. */
    description: {
      type: String,
      trim: true,
      maxlength: [POLICY.DESCRIPTION_MAX, "Description is too long"],
      default: "",
    },
    /** What actually changed, field by field. Empty for actions that change
     * nothing, such as signing in. */
    changes: { type: [changeSchema], default: [] },
    /** Where the request came from. Empty when something other than a browser
     * did it - a seed script, or a scheduled job. */
    context: {
      ipAddress: { type: String, default: null },
      device: { type: String, default: null },
      userAgent: { type: String, default: null },
      method: { type: String, default: null },
      path: { type: String, default: null },
    },
    /** Why it failed, on a failure entry. */
    reason: { type: String, trim: true, default: "" },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

/* The three ways the log actually gets read. */

/** "Everything that happened to this booking." */
auditLogSchema.index({ "entity.type": 1, "entity.id": 1, createdAt: -1 });
/** "Everything this person has done." */
auditLogSchema.index({ "actor.user": 1, createdAt: -1 });
/** "The whole log, newest first" - the default view. */
auditLogSchema.index({ createdAt: -1 });

/**
 * Optional expiry.
 *
 * Some hotels are required to keep records for a fixed number of years and no
 * longer. When `AUDIT_RETENTION_DAYS` is set, MongoDB removes entries past that
 * age by itself; left at zero, the log is kept for good.
 */
if (env.audit.retentionDays > 0) {
  auditLogSchema.index(
    { createdAt: 1 },
    { expireAfterSeconds: env.audit.retentionDays * 86_400 }
  );
}

/**
 * Append-only, enforced.
 *
 * An audit log that the application can rewrite proves nothing, so every route
 * that would change or remove an entry is closed off here. Mongoose has several
 * such routes and each has to be named; missing one would leave a way in.
 */
// Mongoose 9 drives middleware by the returned promise: hooks take no `next`,
// and a hook refuses by throwing. Written with a `next` callback these did not
// merely fail to guard the log - `next` was undefined, so every hook threw,
// including on the writes that were supposed to succeed. `recordAudit` catches
// and logs failures so that recording something can never undo the thing
// itself, which is right, and which is also what hid this for so long.
const refuseChange = function refuseChange() {
  throw new Error("Audit log entries cannot be modified");
};

const refuseRemoval = function refuseRemoval() {
  throw new Error("Audit log entries cannot be deleted");
};

["updateOne", "updateMany", "findOneAndUpdate", "replaceOne"].forEach((operation) => {
  auditLogSchema.pre(operation, refuseChange);
});

["deleteOne", "deleteMany", "findOneAndDelete"].forEach((operation) => {
  auditLogSchema.pre(operation, refuseRemoval);
});

auditLogSchema.pre("save", function preventEdit() {
  if (!this.isNew) {
    throw new Error("Audit log entries cannot be modified");
  }
});

auditLogSchema.methods.toSafeObject = function toSafeObject() {
  const actor = this.actor?.user && this.actor.user.name !== undefined ? this.actor.user : null;

  return {
    id: this._id.toString(),
    action: this.action,
    outcome: this.outcome,
    description: this.description,
    reason: this.reason,

    entity: {
      type: this.entity.type,
      id: this.entity.id ? this.entity.id.toString() : null,
      label: this.entity.label,
    },

    actor: {
      // The live account when it still exists, so a name change is picked up;
      // otherwise the copy taken at the time.
      id: actor ? actor._id.toString() : (this.actor?.user?.toString() ?? null),
      name: actor?.name || this.actor?.name || "System",
      email: actor?.email || this.actor?.email || "",
      role: this.actor?.role || "",
    },

    changes: this.changes.map((change) => ({
      field: change.field,
      from: change.from,
      to: change.to,
    })),

    context: {
      ipAddress: this.context?.ipAddress ?? null,
      device: this.context?.device ?? null,
      method: this.context?.method ?? null,
      path: this.context?.path ?? null,
    },

    at: this.createdAt,
  };
};

export const AuditLog = mongoose.model("AuditLog", auditLogSchema);
export default AuditLog;
