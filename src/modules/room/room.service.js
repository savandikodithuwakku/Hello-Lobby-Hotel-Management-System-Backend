import ApiError from "../../shared/utils/ApiError.js";
import { AUDIT_ACTIONS, AUDIT_ENTITIES } from "../audit/audit.constants.js";
import { recordAudit, recordUpdate } from "../audit/audit.service.js";
import { toId } from "../../shared/utils/id.util.js";
import { paginateQuery } from "../../shared/utils/pagination.util.js";
import { containsInsensitive } from "../../shared/utils/text.util.js";
import Room from "./room.model.js";
import RoomType from "./roomType.model.js";
import {
  DEFAULT_ROOM_SORT,
  HOUSEKEEPING_STATUSES,
  HOUSEKEEPING_STATUS_VALUES,
  OCCUPANCY_STATUSES,
  OCCUPANCY_STATUS_VALUES,
  RELEASE_STATE,
  SELLABLE_HOUSEKEEPING,
  canChangeHousekeeping,
  getAllowedHousekeepingTransitions,
} from "./room.constants.js";

/** Every read populates the type: price and facilities fall back to it. */
const withType = (query) =>
  query.populate("roomType", "name basePrice maxOccupancy facilities isActive");

const findRoomOrFail = async (id) => {
  const room = await withType(Room.findById(id));

  if (!room) {
    throw new ApiError(404, "Room not found");
  }

  return room;
};

const assertTypeIsUsable = async (roomTypeId) => {
  const roomType = await RoomType.findById(roomTypeId);

  if (!roomType) {
    throw new ApiError(404, "The selected room type does not exist");
  }

  if (!roomType.isActive) {
    throw new ApiError(409, `Room type "${roomType.name}" is deactivated and cannot take new rooms`);
  }

  return roomType;
};

/**
 * Applies a housekeeping change and its audit fields in one place, so every
 * path - a housekeeper on the board, a departure, a room coming back into the
 * inventory - records who changed it and why.
 */
const applyHousekeeping = (room, housekeeping, { note, actorId = null } = {}) => {
  room.housekeeping = housekeeping;
  room.housekeepingChangedBy = actorId;
  if (note !== undefined) room.housekeepingNote = note || "";
};

/**
 * Applies an occupancy change. Separate from the above because the two move for
 * entirely different reasons: this one only ever happens because something
 * happened to a booking.
 */
const applyOccupancy = (room, occupancy) => {
  room.occupancy = occupancy;
};

/* -------------------------------------------------------------------------- */
/* Queries                                                                    */
/* -------------------------------------------------------------------------- */

export const listRooms = async ({
  page,
  limit,
  search,
  roomType,
  occupancy,
  housekeeping,
  discrepant,
  floor,
  isActive,
  minPrice,
  maxPrice,
  sort = DEFAULT_ROOM_SORT,
}) => {
  const filter = {};

  if (isActive !== undefined) filter.isActive = isActive;
  if (occupancy) filter.occupancy = occupancy;
  if (housekeeping) filter.housekeeping = housekeeping;
  if (roomType) filter.roomType = roomType;

  // "Empty but not fit to sell" - the rooms quietly costing the hotel money.
  // Expressible only because occupancy and housekeeping are separate fields.
  if (discrepant === true) {
    filter.isActive = true;
    filter.occupancy = OCCUPANCY_STATUSES.VACANT;
    filter.housekeeping = { $nin: SELLABLE_HOUSEKEEPING };
  }
  if (floor !== undefined) filter.floor = floor;
  if (search) filter.roomNumber = containsInsensitive(search);

  // Price filtering has to consider rooms that inherit their type's base price,
  // so the two cases are expressed as one OR: an explicit price in range, or no
  // explicit price and a type whose base price is in range.
  if (minPrice !== undefined || maxPrice !== undefined) {
    const range = {};
    if (minPrice !== undefined) range.$gte = minPrice;
    if (maxPrice !== undefined) range.$lte = maxPrice;

    const typeIds = await RoomType.find({ basePrice: range }).distinct("_id");

    filter.$or = [{ price: range }, { price: null, roomType: { $in: typeIds } }];
  }

  const { documents, pagination } = await paginateQuery(Room, filter, {
    page,
    limit,
    sort,
    decorate: withType,
  });

  return { rooms: documents.map((room) => room.toSafeObject()), pagination };
};

/**
 * Rooms that can be booked or walked into right now.
 *
 * This is *current* availability only. Availability for a future date range
 * depends on bookings and belongs to the reservation module, which will filter
 * this set further by checking its own documents.
 */
export const listAvailableRooms = async ({ roomType, floor, occupancy: partySize }) => {
  // Both statuses have to agree before a room can be walked into.
  const filter = {
    isActive: true,
    occupancy: OCCUPANCY_STATUSES.VACANT,
    housekeeping: { $in: SELLABLE_HOUSEKEEPING },
  };

  if (roomType) filter.roomType = roomType;
  if (floor !== undefined) filter.floor = floor;

  if (partySize !== undefined) {
    // Only types that seat the requested party size.
    const typeIds = await RoomType.find({
      maxOccupancy: { $gte: partySize },
      isActive: true,
    }).distinct("_id");

    filter.roomType = roomType ? roomType : { $in: typeIds };
  }

  const rooms = await withType(Room.find(filter).sort(DEFAULT_ROOM_SORT));

  return { rooms: rooms.map((room) => room.toSafeObject()), total: rooms.length };
};

/** Inventory summary for dashboards and the front desk board. */
export const getRoomStatistics = async () => {
  const [byOccupancy, byHousekeeping, byType, totals, discrepant] = await Promise.all([
    Room.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: "$occupancy", count: { $sum: 1 } } },
    ]),
    Room.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: "$housekeeping", count: { $sum: 1 } } },
    ]),
    Room.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: "$roomType", count: { $sum: 1 } } },
      {
        $lookup: { from: "roomtypes", localField: "_id", foreignField: "_id", as: "type" },
      },
      { $unwind: "$type" },
      { $project: { _id: 0, roomTypeId: "$_id", name: "$type.name", count: 1 } },
      { $sort: { name: 1 } },
    ]),
    Room.countDocuments({}),
    Room.countDocuments({
      isActive: true,
      occupancy: OCCUPANCY_STATUSES.VACANT,
      housekeeping: { $nin: SELLABLE_HOUSEKEEPING },
    }),
  ]);

  // Report every status, including the ones with no rooms in them, so a board
  // shows a zero rather than the row disappearing.
  const tally = (rows, values) => {
    const counts = Object.fromEntries(values.map((value) => [value, 0]));
    rows.forEach((row) => {
      counts[row._id] = row.count;
    });
    return counts;
  };

  const occupancyCounts = tally(byOccupancy, OCCUPANCY_STATUS_VALUES);
  const housekeepingCounts = tally(byHousekeeping, HOUSEKEEPING_STATUS_VALUES);

  const active = byOccupancy.reduce((sum, row) => sum + row.count, 0);

  // Sellable needs both: nobody in the room, and fit for a guest. Counting
  // vacant rooms alone would promise rooms that have not been cleaned.
  const sellable = await Room.countDocuments({
    isActive: true,
    occupancy: OCCUPANCY_STATUSES.VACANT,
    housekeeping: { $in: SELLABLE_HOUSEKEEPING },
  });

  return {
    total: totals,
    active,
    inactive: totals - active,
    sellable,
    /** Empty rooms that cannot be sold because nobody has serviced them. */
    discrepant,
    occupancyRate:
      active === 0
        ? 0
        : Math.round((occupancyCounts[OCCUPANCY_STATUSES.OCCUPIED] / active) * 100),
    byOccupancy: occupancyCounts,
    byHousekeeping: housekeepingCounts,
    byRoomType: byType,
  };
};

export const getRoomById = async (id) => {
  const room = await findRoomOrFail(id);
  return {
    ...room.toSafeObject(),
    allowedHousekeepingTransitions: getAllowedHousekeepingTransitions(room.housekeeping),
  };
};

/* -------------------------------------------------------------------------- */
/* Writes                                                                     */
/* -------------------------------------------------------------------------- */


/* -------------------------------------------------------------------------- */
/* Audit                                                                      */
/* -------------------------------------------------------------------------- */

/** A room is named in the log by its number, which is how staff refer to it. */
const auditEntity = (room) => ({
  type: AUDIT_ENTITIES.ROOM,
  id: room._id,
  label: room.roomNumber,
});

const auditSnapshot = (room) => ({
  roomNumber: room.roomNumber,
  roomType: room.roomType?.name ?? toId(room.roomType),
  floor: room.floor,
  price: room.price,
  facilities: [...room.facilities],
});

export const createRoom = async (actor, { roomNumber, roomType, floor, price, facilities, housekeeping, housekeepingNote }) => {
  const normalisedNumber = roomNumber.trim().toUpperCase();

  const existing = await Room.findOne({ roomNumber: normalisedNumber });

  if (existing) {
    // Numbers stay reserved even when a room is retired, so point the operator
    // at the room they almost certainly meant instead of silently failing.
    throw new ApiError(
      409,
      existing.isActive
        ? `Room ${normalisedNumber} already exists`
        : `Room ${normalisedNumber} exists but is deactivated. Restore it instead of creating a duplicate.`
    );
  }

  await assertTypeIsUsable(roomType);

  // Occupancy is not accepted at all: a room becomes reserved or occupied only
  // because a booking says so, never because somebody typed it into a form.

  const room = new Room({
    roomNumber: normalisedNumber,
    roomType,
    floor,
    price: price ?? null,
    facilities: facilities || [],
    occupancy: OCCUPANCY_STATUSES.VACANT,
    // A brand new room has not been serviced, so it starts dirty rather than
    // being offered to a guest before anyone has looked at it.
    housekeeping: housekeeping || HOUSEKEEPING_STATUSES.DIRTY,
    housekeepingNote: housekeepingNote || "",
    housekeepingChangedBy: actor._id,
    createdBy: actor._id,
    updatedBy: actor._id,
  });

  await room.save();

  await recordAudit({
    action: AUDIT_ACTIONS.ROOM_CREATED,
    entity: auditEntity(room),
    actor,
    description: `Added room ${room.roomNumber} on floor ${room.floor}`,
  });

  return getRoomById(room._id);
};

/**
 * Edits the room's identity and pricing. Neither status is accepted here:
 * housekeeping moves through `changeHousekeepingStatus`, which enforces its
 * state machine, and occupancy only ever moves because of a booking.
 */
export const updateRoom = async (actor, id, { roomNumber, roomType, floor, price, facilities }) => {
  const room = await findRoomOrFail(id);

  const before = auditSnapshot(room);

  if (roomNumber !== undefined) {
    const normalisedNumber = roomNumber.trim().toUpperCase();

    if (normalisedNumber !== room.roomNumber) {
      if (room.isInUse()) {
        throw new ApiError(409, "A reserved or occupied room cannot be renumbered");
      }

      if (await Room.exists({ roomNumber: normalisedNumber })) {
        throw new ApiError(409, `Room ${normalisedNumber} already exists`);
      }

      room.roomNumber = normalisedNumber;
    }
  }

  if (roomType !== undefined && String(roomType) !== String(toId(room.roomType))) {
    if (room.isInUse()) {
      throw new ApiError(409, "A reserved or occupied room cannot change its type");
    }

    await assertTypeIsUsable(roomType);
    room.roomType = roomType;
  }

  if (floor !== undefined) room.floor = floor;
  // `null` is meaningful: it clears the override and returns the room to the
  // type's base price.
  if (price !== undefined) room.price = price;
  if (facilities !== undefined) room.facilities = facilities;

  room.updatedBy = actor._id;
  await room.save();

  await recordUpdate({
    action: AUDIT_ACTIONS.ROOM_UPDATED,
    entity: auditEntity(room),
    actor,
    before,
    after: auditSnapshot(await findRoomOrFail(room._id)),
    description: `Edited room ${room.roomNumber}`,
  });

  return getRoomById(room._id);
};

/**
 * Housekeeping and maintenance transitions.
 *
 * Reserved and occupied are refused: a room is only freed when its booking
 * ends, through `releaseRoom` below.
 */
export const changeHousekeepingStatus = async (actor, id, { housekeeping, note }) => {
  const room = await findRoomOrFail(id);

  if (!room.isActive) {
    throw new ApiError(409, "This room is deactivated. Restore it before servicing it.");
  }

  if (housekeeping === room.housekeeping) {
    // Nothing to change, but a new note is still worth recording.
    if (note !== undefined && note !== room.housekeepingNote) {
      room.housekeepingNote = note || "";
      room.updatedBy = actor._id;
      await room.save();
    }
    return getRoomById(room._id);
  }

  if (!canChangeHousekeeping(room.housekeeping, housekeeping)) {
    const allowed = getAllowedHousekeepingTransitions(room.housekeeping);
    throw new ApiError(409, `A ${room.housekeeping} room can only move to: ${allowed.join(", ")}`);
  }

  // A guest being in the room is no reason to refuse. An occupied room is
  // serviced every day, and being able to record that is the whole point of
  // keeping housekeeping separate from occupancy.
  const previousStatus = room.housekeeping;

  applyHousekeeping(room, housekeeping, { note, actorId: actor._id });
  room.updatedBy = actor._id;
  await room.save();

  await recordAudit({
    action: AUDIT_ACTIONS.ROOM_HOUSEKEEPING_CHANGED,
    entity: auditEntity(room),
    actor,
    description: `Room ${room.roomNumber}: ${previousStatus} to ${housekeeping}`,
    changes: [{ field: "housekeeping", from: previousStatus, to: housekeeping }],
    reason: note || "",
  });

  return getRoomById(room._id);
};

/**
 * Soft delete: the room leaves the inventory but its document stays, so past
 * reservations still resolve to a real room.
 */
export const deactivateRoom = async (actor, id, { note } = {}) => {
  const room = await findRoomOrFail(id);

  if (!room.isActive) {
    return getRoomById(room._id);
  }

  if (room.isInUse()) {
    throw new ApiError(
      409,
      `Room ${room.roomNumber} is ${room.occupancy}. Wait until the guest checks out before removing it.`
    );
  }

  room.isActive = false;
  applyHousekeeping(room, HOUSEKEEPING_STATUSES.OUT_OF_ORDER, {
    note: note || "Removed from inventory",
    actorId: actor._id,
  });
  room.updatedBy = actor._id;
  await room.save();

  await recordAudit({
    action: AUDIT_ACTIONS.ROOM_DEACTIVATED,
    entity: auditEntity(room),
    actor,
    description: `Took room ${room.roomNumber} out of the inventory`,
    reason: note || "",
  });

  return getRoomById(room._id);
};

/**
 * Brings a room back. It returns as `cleaning` rather than `available`: a room
 * that has been out of the inventory should be checked before a guest is sent
 * to it.
 */
export const restoreRoom = async (actor, id) => {
  const room = await findRoomOrFail(id);

  if (room.isActive) {
    return getRoomById(room._id);
  }

  const roomType = await RoomType.findById(toId(room.roomType));

  if (!roomType?.isActive) {
    throw new ApiError(
      409,
      "This room's type is deactivated. Restore the type, or move the room to an active one first."
    );
  }

  room.isActive = true;
  // Comes back needing a clean rather than straight to sellable: it has been
  // sitting unused and should be looked at before a guest is sent to it.
  applyHousekeeping(room, HOUSEKEEPING_STATUSES.CLEANING, {
    note: "Returned to inventory",
    actorId: actor._id,
  });
  room.updatedBy = actor._id;
  await room.save();

  await recordAudit({
    action: AUDIT_ACTIONS.ROOM_RESTORED,
    entity: auditEntity(room),
    actor,
    description: `Returned room ${room.roomNumber} to the inventory`,
  });

  return getRoomById(room._id);
};

/* -------------------------------------------------------------------------- */
/* Reservation lifecycle hooks                                                */
/*                                                                            */
/* The room module owns occupancy, so the reservation and front-desk modules   */
/* call these instead of writing the field themselves. They are not exposed as  */
/* HTTP routes. None of them touches housekeeping except a departure, which     */
/* always leaves the room dirty.                                               */
/* -------------------------------------------------------------------------- */

/** Booking confirmed: available -> reserved. */
export const reserveRoom = async (id, { actorId = null, note } = {}) => {
  const room = await findRoomOrFail(id);

  if (!room.isBookable()) {
    throw new ApiError(
      409,
      `Room ${room.roomNumber} cannot be held right now (${room.occupancy}, ${room.housekeeping})`
    );
  }

  applyOccupancy(room, OCCUPANCY_STATUSES.RESERVED);
  await room.save();
  return room;
};

/** Guest arrives: reserved -> occupied. */
export const checkInRoom = async (id, { actorId = null, note } = {}) => {
  const room = await findRoomOrFail(id);

  if (room.occupancy !== OCCUPANCY_STATUSES.RESERVED) {
    throw new ApiError(409, `Room ${room.roomNumber} is not reserved (currently ${room.occupancy})`);
  }

  applyOccupancy(room, OCCUPANCY_STATUSES.OCCUPIED);
  await room.save();
  return room;
};

/**
 * The booking is over - cancelled, expired or checked out - so the room goes
 * back into circulation on its own.
 *
 * A cancelled reservation frees the room immediately; a departure sends it to
 * housekeeping first. Anything else (a room already under maintenance) is left
 * exactly as it is.
 */
export const releaseRoom = async (id, { actorId = null, note } = {}) => {
  const room = await findRoomOrFail(id);

  const next = RELEASE_STATE[room.occupancy];

  if (!next) {
    return room;
  }

  applyOccupancy(room, next.occupancy);

  // A departure always leaves the room dirty; a cancellation never touched the
  // room, so its housekeeping state is left exactly as it was.
  if (next.housekeeping) {
    applyHousekeeping(room, next.housekeeping, { note: note ?? "", actorId });
  }

  await room.save();
  return room;
};
