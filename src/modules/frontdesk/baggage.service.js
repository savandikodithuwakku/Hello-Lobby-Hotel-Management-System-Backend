import ApiError from "../../shared/utils/ApiError.js";
import { toId } from "../../shared/utils/id.util.js";
import { paginateQuery } from "../../shared/utils/pagination.util.js";
import { containsInsensitive } from "../../shared/utils/text.util.js";
import { PERMISSIONS } from "../auth/rbac/index.js";
import { AUDIT_ACTIONS, AUDIT_ENTITIES } from "../audit/audit.constants.js";
import { recordAudit } from "../audit/audit.service.js";
import User from "../user/user.model.js";
import Reservation from "../reservation/reservation.model.js";
import Baggage, { generateBaggageTag } from "./baggage.model.js";
import {
  BAGGAGE_STATUSES,
  DEFAULT_BAGGAGE_SORT,
  POLICY,
} from "./baggage.constants.js";

const withRelations = (query) =>
  query
    .populate("guest", "name email")
    .populate("receivedBy", "name")
    .populate("collectedBy", "name")
    .populate("reservation", "reference");

const canManage = (viewer) =>
  Boolean(viewer?.hasPermission(PERMISSIONS.FRONTDESK_BAGGAGE_MANAGE));

const auditEntity = (baggage) => ({
  type: AUDIT_ENTITIES.BAGGAGE,
  id: baggage._id,
  label: baggage.tag,
});

const findBaggageOrFail = async (id) => {
  const baggage = await withRelations(Baggage.findById(id));

  if (!baggage) throw new ApiError(404, "Baggage record not found");

  return baggage;
};

/**
 * A guest may look up their own baggage and nothing else - which is the point
 * of the claim tag, not of this check, but it means the app can show somebody
 * what the desk is holding for them.
 */
const assertCanView = (viewer, baggage) => {
  if (canManage(viewer)) return;

  const ownerId = toId(baggage.guest);

  if (!ownerId || !viewer._id.equals(ownerId)) {
    throw new ApiError(404, "Baggage record not found");
  }
};

/* -------------------------------------------------------------------------- */
/* Taking it in                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Works out whose bags these are.
 *
 * Either an account or a written-down name is required. Baggage recorded
 * against nobody cannot be handed back to anybody, and a hotel that has taken a
 * suitcase from an anonymous person has a problem, not a record.
 */
const resolveOwner = async (payload) => {
  const reservation = payload.reservation
    ? await Reservation.findById(payload.reservation)
    : null;

  if (payload.reservation && !reservation) {
    throw new ApiError(404, "The selected reservation does not exist");
  }

  const guestId = payload.guest ?? (reservation ? toId(reservation.customer) : null);
  const guest = guestId ? await User.findById(guestId) : null;

  if (guestId && !guest) {
    throw new ApiError(404, "The selected guest does not exist");
  }

  const guestName = String(payload.guestName ?? "").trim();

  if (!guest && !guestName) {
    throw new ApiError(400, "Say whose baggage this is - pick a guest or write down a name");
  }

  return {
    guest: guest?._id ?? null,
    guestName: guest ? "" : guestName,
    reservation: reservation?._id ?? null,
  };
};

/**
 * Takes baggage in and produces the tag number the guest is given.
 *
 * Two lots taken at once can both generate the same tag; the unique index lets
 * exactly one save, and the loser is retried with a new tag rather than the
 * desk being shown an error for something the system can sort out itself.
 */
export const storeBaggage = async (actor, payload) => {
  const owner = await resolveOwner(payload);

  const build = () =>
    new Baggage({
      tag: generateBaggageTag(),
      ...owner,
      bagCount: payload.bagCount,
      description: payload.description || "",
      location: payload.location || "",
      receivedAt: payload.receivedAt ? new Date(payload.receivedAt) : new Date(),
      receivedBy: actor._id,
      note: payload.note || "",
      createdBy: actor._id,
      updatedBy: actor._id,
    });

  let baggage = build();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await baggage.save();
      break;
    } catch (error) {
      if (error?.code !== 11000 || attempt === 2) throw error;
      baggage = build();
    }
  }

  await recordAudit({
    action: AUDIT_ACTIONS.BAGGAGE_STORED,
    entity: auditEntity(baggage),
    actor,
    description:
      `Took in ${baggage.bagCount} piece(s) for ` +
      `${owner.guestName || (await User.findById(owner.guest))?.name || "a guest"}`,
    reason: baggage.location ? `Stored at ${baggage.location}` : "",
  });

  return getBaggageById(baggage._id, actor);
};

/* -------------------------------------------------------------------------- */
/* Reading                                                                    */
/* -------------------------------------------------------------------------- */

export const listBaggage = async (query, viewer) => {
  const {
    page,
    limit,
    search,
    status,
    guest,
    reservation,
    sort = DEFAULT_BAGGAGE_SORT,
  } = query;

  const filter = {};

  if (canManage(viewer)) {
    if (guest) filter.guest = guest;
  } else {
    filter.guest = viewer._id;
  }

  if (reservation) filter.reservation = reservation;

  // The status is worked out from the dates, so filtering by it means saying
  // the same thing as a query. The two definitions sit next to each other in
  // `deriveBaggageStatus` and here so they cannot drift apart.
  if (status === BAGGAGE_STATUSES.COLLECTED) {
    filter.collectedAt = { $ne: null };
  } else if (status === BAGGAGE_STATUSES.STORED) {
    filter.collectedAt = null;
    filter.receivedAt = { $gte: unclaimedCutoff() };
  } else if (status === BAGGAGE_STATUSES.UNCLAIMED) {
    filter.collectedAt = null;
    filter.receivedAt = { $lt: unclaimedCutoff() };
  }

  if (search) {
    const pattern = containsInsensitive(search);
    const guestIds = canManage(viewer)
      ? await User.find({ $or: [{ name: pattern }, { email: pattern }] }).distinct("_id")
      : [];

    filter.$and = [
      ...(filter.$and || []),
      {
        $or: [
          { tag: pattern },
          { guestName: pattern },
          { description: pattern },
          { location: pattern },
          ...(guestIds.length > 0 ? [{ guest: { $in: guestIds } }] : []),
        ],
      },
    ];
  }

  const { documents, pagination } = await paginateQuery(Baggage, filter, {
    page,
    limit,
    sort,
    decorate: withRelations,
  });

  return { baggage: documents.map((item) => item.toSafeObject()), pagination };
};

const unclaimedCutoff = () =>
  new Date(Date.now() - POLICY.UNCLAIMED_AFTER_DAYS * 86_400_000);

export const getBaggageById = async (id, viewer) => {
  const baggage = await findBaggageOrFail(id);
  assertCanView(viewer, baggage);

  return baggage.toSafeObject();
};

/**
 * Looks baggage up by the number on the guest's ticket.
 *
 * The way it is actually found at a desk: somebody hands over a paper tag, not
 * a database id.
 */
export const getBaggageByTag = async (tag, viewer) => {
  const baggage = await withRelations(Baggage.findOne({ tag: String(tag).toUpperCase().trim() }));

  if (!baggage) throw new ApiError(404, "No baggage is held under that tag");

  assertCanView(viewer, baggage);

  return baggage.toSafeObject();
};

/** What the desk is holding right now, and what has been here too long. */
export const getBaggageStatistics = async () => {
  const cutoff = unclaimedCutoff();

  const [stored, unclaimed, pieces] = await Promise.all([
    Baggage.countDocuments({ collectedAt: null, receivedAt: { $gte: cutoff } }),
    Baggage.countDocuments({ collectedAt: null, receivedAt: { $lt: cutoff } }),
    Baggage.aggregate([
      { $match: { collectedAt: null } },
      { $group: { _id: null, total: { $sum: "$bagCount" } } },
    ]),
  ]);

  return {
    stored,
    /** Held longer than the policy allows. Somebody has to look at these. */
    unclaimed,
    heldNow: stored + unclaimed,
    piecesHeld: pieces[0]?.total ?? 0,
    unclaimedAfterDays: POLICY.UNCLAIMED_AFTER_DAYS,
  };
};

/* -------------------------------------------------------------------------- */
/* Giving it back                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Hands the bags over.
 *
 * Who took them is written down, because it is not always the guest, and
 * "somebody collected them" is not an answer when a guest comes back for
 * baggage that has gone.
 */
export const collectBaggage = async (actor, id, { collectedByName = "", note = "" } = {}) => {
  const baggage = await findBaggageOrFail(id);

  if (baggage.collectedAt) {
    throw new ApiError(
      409,
      `These bags were already handed back on ${baggage.collectedAt.toDateString()}`
    );
  }

  baggage.collectedAt = new Date();
  baggage.collectedBy = actor._id;
  baggage.collectedByName = String(collectedByName).trim();
  if (note) baggage.note = note;
  baggage.updatedBy = actor._id;

  await baggage.save();

  await recordAudit({
    action: AUDIT_ACTIONS.BAGGAGE_COLLECTED,
    entity: auditEntity(baggage),
    actor,
    description:
      `Handed back ${baggage.bagCount} piece(s) held for ${baggage.daysHeld} day(s)` +
      (baggage.collectedByName ? ` to ${baggage.collectedByName}` : ""),
    changes: [{ field: "status", from: BAGGAGE_STATUSES.STORED, to: BAGGAGE_STATUSES.COLLECTED }],
    reason: note,
  });

  return getBaggageById(baggage._id, actor);
};

/** Corrects the details of baggage still being held - where it is, what it is. */
export const updateBaggage = async (actor, id, payload) => {
  const baggage = await findBaggageOrFail(id);

  if (baggage.collectedAt) {
    throw new ApiError(409, "These bags have already been handed back");
  }

  if (payload.location !== undefined) baggage.location = payload.location;
  if (payload.description !== undefined) baggage.description = payload.description;
  if (payload.bagCount !== undefined) baggage.bagCount = payload.bagCount;
  if (payload.note !== undefined) baggage.note = payload.note;

  baggage.updatedBy = actor._id;
  await baggage.save();

  return getBaggageById(baggage._id, actor);
};
