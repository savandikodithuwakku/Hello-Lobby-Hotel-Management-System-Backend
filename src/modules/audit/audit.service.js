import ApiError from "../../shared/utils/ApiError.js";
import { toId } from "../../shared/utils/id.util.js";
import { paginateQuery } from "../../shared/utils/pagination.util.js";
import { containsInsensitive } from "../../shared/utils/text.util.js";
import { getRequestContext } from "../../shared/context/requestContext.js";
import User from "../user/user.model.js";
import AuditLog from "./audit.model.js";
import {
  AUDIT_OUTCOMES,
  DEFAULT_AUDIT_SORT,
  POLICY,
  REDACTED_PLACEHOLDER,
  SECURITY_ACTIONS,
  isRedactedField,
} from "./audit.constants.js";

/* -------------------------------------------------------------------------- */
/* Turning values into something a log can hold                               */
/* -------------------------------------------------------------------------- */

/**
 * Renders one value as short, readable text.
 *
 * Dates become plain ISO strings, references become their id, objects become
 * compact JSON, and anything overlong is cut off. The point is that whoever
 * reads the entry later can see what the value was without having to know
 * anything about how the field was stored.
 */
export const describeValue = (value) => {
  if (value === undefined || value === null) return null;

  if (value instanceof Date) return value.toISOString();

  if (Array.isArray(value)) {
    return truncate(value.map((item) => plain(item)).join(", "));
  }

  if (typeof value === "object") {
    // A populated reference or a raw ObjectId reads best as its id.
    if (value._id) return String(value._id);
    if (typeof value.toHexString === "function") return value.toHexString();

    try {
      return truncate(JSON.stringify(value));
    } catch {
      return truncate(String(value));
    }
  }

  return truncate(String(value));
};

const plain = (value) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return value._id ? String(value._id) : JSON.stringify(value);
  return String(value);
};

const truncate = (text) =>
  text.length > POLICY.VALUE_MAX ? `${text.slice(0, POLICY.VALUE_MAX - 1)}…` : text;

/**
 * Works out what actually changed between two snapshots.
 *
 * Only fields that really moved are recorded - an edit form that posts every
 * field back unchanged should produce an entry saying nothing changed, not a
 * wall of identical before-and-after pairs. Secrets are reported as having
 * changed without their values ever being written down.
 */
export const describeChanges = (before = {}, after = {}, fields = null) => {
  const names = fields ?? [...new Set([...Object.keys(before), ...Object.keys(after)])];

  return names
    .filter((field) => after[field] !== undefined)
    .map((field) => {
      const from = describeValue(before[field]);
      const to = describeValue(after[field]);

      if (from === to) return null;

      return isRedactedField(field)
        ? { field, from: REDACTED_PLACEHOLDER, to: REDACTED_PLACEHOLDER }
        : { field, from, to };
    })
    .filter(Boolean)
    .slice(0, POLICY.MAX_CHANGES);
};

/** Takes the named fields off a document, ready to compare against later. */
export const snapshot = (document, fields) =>
  Object.fromEntries(fields.map((field) => [field, document?.[field]]));

/* -------------------------------------------------------------------------- */
/* Writing                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Who is doing this.
 *
 * Taken from the actor the caller passed if there is one, otherwise from the
 * request context that the middleware opened. Falls back to nothing at all,
 * which is the honest answer for a seed script: there was no person.
 */
const resolveActor = (actor) => {
  const person = actor ?? getRequestContext().user ?? null;

  if (!person) return { user: null, name: "System", email: "", role: "" };

  return {
    user: toId(person) ?? null,
    // Copied as they are now, so the entry still reads correctly if the account
    // is later renamed, promoted or deleted.
    name: person.name ?? "",
    email: person.email ?? "",
    role: person.role ?? "",
  };
};

const resolveContext = () => {
  const { ipAddress, device, userAgent, method, path } = getRequestContext();

  return {
    ipAddress: ipAddress ?? null,
    device: device ?? null,
    userAgent: userAgent ?? null,
    method: method ?? null,
    path: path ?? null,
  };
};

/**
 * Writes one entry.
 *
 * Never throws. Recording that something happened must not be able to undo the
 * thing itself: a booking that was made and a payment that was taken have to
 * stand even if the log cannot be written, so a failure here is reported to the
 * server console and the caller carries on. This is the same reasoning as
 * `sendEmailSafely` - a supporting action must not break the real one.
 */
export const recordAudit = async ({
  action,
  entity,
  actor = null,
  description = "",
  changes = [],
  outcome = AUDIT_OUTCOMES.SUCCESS,
  reason = "",
}) => {
  try {
    const entry = await AuditLog.create({
      action,
      entity: {
        type: entity.type,
        id: entity.id ? toId(entity.id) : null,
        label: entity.label ?? "",
      },
      actor: resolveActor(actor),
      outcome,
      description,
      reason,
      changes,
      context: resolveContext(),
    });

    return entry;
  } catch (error) {
    console.error(`Failed to write audit entry "${action}":`, error.message);
    return null;
  }
};

/** Shorthand for the common "this went wrong" entry. */
export const recordAuditFailure = ({ action, entity, actor = null, reason, description = "" }) =>
  recordAudit({
    action,
    entity,
    actor,
    description,
    reason,
    outcome: AUDIT_OUTCOMES.FAILURE,
  });

/**
 * Records an edit, working out the changes itself.
 *
 * The usual shape at a call site: take a snapshot before touching the document,
 * make the change, then hand both to this. Returns nothing useful on purpose -
 * a caller should never branch on whether the log was written.
 */
export const recordUpdate = async ({
  action,
  entity,
  actor = null,
  before,
  after,
  fields = null,
  description = "",
}) => {
  const changes = describeChanges(before, after, fields);

  // An edit that changed nothing is not worth an entry; it only makes the log
  // harder to read.
  if (changes.length === 0) return null;

  return recordAudit({ action, entity, actor, description, changes });
};

/* -------------------------------------------------------------------------- */
/* Reading                                                                    */
/* -------------------------------------------------------------------------- */

const withRelations = (query) => query.populate("actor.user", "name email role");

export const listAuditLog = async (query) => {
  const {
    page,
    limit,
    action,
    entityType,
    entityId,
    actor,
    outcome,
    security,
    search,
    from,
    to,
    sort = DEFAULT_AUDIT_SORT,
  } = query;

  const filter = {};

  if (action) filter.action = action;
  if (entityType) filter["entity.type"] = entityType;
  if (entityId) filter["entity.id"] = entityId;
  if (actor) filter["actor.user"] = actor;
  if (outcome) filter.outcome = outcome;

  // One switch for "show me only the entries a security review cares about",
  // rather than making the caller list nine actions by hand.
  if (security === true) filter.action = filter.action || { $in: SECURITY_ACTIONS };

  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(from);
    if (to) filter.createdAt.$lte = new Date(to);
  }

  if (search) {
    const pattern = containsInsensitive(search);
    const actorIds = await User.find({
      $or: [{ name: pattern }, { email: pattern }],
    }).distinct("_id");

    filter.$and = [
      ...(filter.$and || []),
      {
        $or: [
          { "entity.label": pattern },
          { description: pattern },
          { "actor.name": pattern },
          { "actor.email": pattern },
          { "actor.user": { $in: actorIds } },
        ],
      },
    ];
  }

  const { documents, pagination } = await paginateQuery(AuditLog, filter, {
    page,
    limit,
    sort,
    decorate: withRelations,
  });

  return { entries: documents.map((entry) => entry.toSafeObject()), pagination };
};

/** Everything that has ever happened to one record. */
export const getEntityTrail = async (entityType, entityId, query = {}) =>
  listAuditLog({ ...query, entityType, entityId });

export const getAuditEntry = async (id) => {
  const entry = await withRelations(AuditLog.findById(id));

  if (!entry) throw new ApiError(404, "Audit entry not found");

  return entry.toSafeObject();
};

/** The counts the security screen leads with. */
export const getAuditStatistics = async ({ days = 7 } = {}) => {
  const since = new Date(Date.now() - days * 86_400_000);

  const [byAction, failures, actors, total] = await Promise.all([
    AuditLog.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: "$action", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),
    AuditLog.countDocuments({
      createdAt: { $gte: since },
      outcome: AUDIT_OUTCOMES.FAILURE,
    }),
    AuditLog.distinct("actor.user", { createdAt: { $gte: since }, "actor.user": { $ne: null } }),
    AuditLog.countDocuments({ createdAt: { $gte: since } }),
  ]);

  return {
    days,
    total,
    failures,
    activeActors: actors.length,
    busiestActions: byAction.map((row) => ({ action: row._id, count: row.count })),
  };
};
