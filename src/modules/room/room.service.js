import ApiError from "../../shared/utils/ApiError.js";
import { toId } from "../../shared/utils/id.util.js";
import { paginateQuery } from "../../shared/utils/pagination.util.js";
import { containsInsensitive } from "../../shared/utils/text.util.js";
import Room from "./room.model.js";
import RoomType from "./roomType.model.js";
import {
  BOOKABLE_STATUSES,
  DEFAULT_ROOM_SORT,
  RELEASE_STATUS,
  RESERVATION_CONTROLLED_STATUSES,
  ROOM_STATUSES,
  ROOM_STATUS_VALUES,
  canTransitionManually,
  getAllowedTransitions,
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
 * Applies a status change and its audit fields in one place, so every path
 * (manual, reservation-driven or reactivation) records who changed what.
 */
const applyStatus = (room, status, { note, actorId = null } = {}) => {
  room.status = status;
  room.statusChangedBy = actorId;
  if (note !== undefined) room.statusNote = note || "";
};

/* -------------------------------------------------------------------------- */
/* Queries                                                                    */
/* -------------------------------------------------------------------------- */

export const listRooms = async ({
  page,
  limit,
  search,
  roomType,
  status,
  floor,
  isActive,
  minPrice,
  maxPrice,
  sort = DEFAULT_ROOM_SORT,
}) => {
  const filter = {};

  if (isActive !== undefined) filter.isActive = isActive;
  if (status) filter.status = status;
  if (roomType) filter.roomType = roomType;
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
export const listAvailableRooms = async ({ roomType, floor, occupancy }) => {
  const filter = { isActive: true, status: { $in: BOOKABLE_STATUSES } };

  if (roomType) filter.roomType = roomType;
  if (floor !== undefined) filter.floor = floor;

  if (occupancy !== undefined) {
    // Only types that seat the requested party size.
    const typeIds = await RoomType.find({
      maxOccupancy: { $gte: occupancy },
      isActive: true,
    }).distinct("_id");

    filter.roomType = roomType ? roomType : { $in: typeIds };
  }

  const rooms = await withType(Room.find(filter).sort(DEFAULT_ROOM_SORT));

  return { rooms: rooms.map((room) => room.toSafeObject()), total: rooms.length };
};

/** Inventory summary for dashboards and the front desk board. */
export const getRoomStatistics = async () => {
  const [byStatus, byType, totals] = await Promise.all([
    Room.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
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
  ]);

  // Report every status, including the ones with no rooms in them.
  const statusCounts = Object.fromEntries(ROOM_STATUS_VALUES.map((status) => [status, 0]));
  byStatus.forEach((row) => {
    statusCounts[row._id] = row.count;
  });

  const active = byStatus.reduce((sum, row) => sum + row.count, 0);

  return {
    total: totals,
    active,
    inactive: totals - active,
    available: statusCounts[ROOM_STATUSES.AVAILABLE],
    occupancyRate: active === 0 ? 0 : Math.round((statusCounts[ROOM_STATUSES.OCCUPIED] / active) * 100),
    byStatus: statusCounts,
    byRoomType: byType,
  };
};

export const getRoomById = async (id) => {
  const room = await findRoomOrFail(id);
  return {
    ...room.toSafeObject(),
    allowedTransitions: getAllowedTransitions(room.status),
  };
};

/* -------------------------------------------------------------------------- */
/* Writes                                                                     */
/* -------------------------------------------------------------------------- */

export const createRoom = async (actor, { roomNumber, roomType, floor, price, facilities, status, statusNote }) => {
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

  if (status && RESERVATION_CONTROLLED_STATUSES.includes(status)) {
    throw new ApiError(400, "A new room cannot start out reserved or occupied");
  }

  const room = new Room({
    roomNumber: normalisedNumber,
    roomType,
    floor,
    price: price ?? null,
    facilities: facilities || [],
    status: status || ROOM_STATUSES.AVAILABLE,
    statusNote: statusNote || "",
    statusChangedBy: actor._id,
    createdBy: actor._id,
    updatedBy: actor._id,
  });

  await room.save();

  return getRoomById(room._id);
};

/**
 * Edits the room's identity and pricing. Status is deliberately not accepted
 * here - it moves through `changeRoomStatus`, which enforces the state machine.
 */
export const updateRoom = async (actor, id, { roomNumber, roomType, floor, price, facilities }) => {
  const room = await findRoomOrFail(id);

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

  return getRoomById(room._id);
};

/**
 * Housekeeping and maintenance transitions.
 *
 * Reserved and occupied are refused: a room is only freed when its booking
 * ends, through `releaseRoom` below.
 */
export const changeRoomStatus = async (actor, id, { status, note }) => {
  const room = await findRoomOrFail(id);

  if (!room.isActive) {
    throw new ApiError(409, "This room is deactivated. Restore it before changing its status.");
  }

  if (RESERVATION_CONTROLLED_STATUSES.includes(status)) {
    throw new ApiError(
      409,
      "Reserved and occupied are set by the reservation and check-in flows, not by hand"
    );
  }

  if (status === room.status) {
    // Nothing to change, but a new note is still worth recording.
    if (note !== undefined && note !== room.statusNote) {
      room.statusNote = note || "";
      room.updatedBy = actor._id;
      await room.save();
    }
    return getRoomById(room._id);
  }

  if (!canTransitionManually(room.status, status)) {
    const allowed = getAllowedTransitions(room.status);
    throw new ApiError(
      409,
      allowed.length === 0
        ? `A ${room.status} room cannot be changed by hand; it is released by the reservation flow`
        : `A ${room.status} room can only move to: ${allowed.join(", ")}`
    );
  }

  applyStatus(room, status, { note, actorId: actor._id });
  room.updatedBy = actor._id;
  await room.save();

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
      `Room ${room.roomNumber} is ${room.status}. Wait until the guest checks out before removing it.`
    );
  }

  room.isActive = false;
  applyStatus(room, ROOM_STATUSES.OUT_OF_SERVICE, {
    note: note || "Removed from inventory",
    actorId: actor._id,
  });
  room.updatedBy = actor._id;
  await room.save();

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
  applyStatus(room, ROOM_STATUSES.CLEANING, {
    note: "Returned to inventory",
    actorId: actor._id,
  });
  room.updatedBy = actor._id;
  await room.save();

  return getRoomById(room._id);
};

/* -------------------------------------------------------------------------- */
/* Reservation lifecycle hooks                                                */
/*                                                                            */
/* The room module owns the room's status, so the reservation and front-desk   */
/* modules call these instead of writing `status` themselves. They are not     */
/* exposed as HTTP routes.                                                    */
/* -------------------------------------------------------------------------- */

/** Booking confirmed: available -> reserved. */
export const reserveRoom = async (id, { actorId = null, note } = {}) => {
  const room = await findRoomOrFail(id);

  if (!room.isBookable()) {
    throw new ApiError(409, `Room ${room.roomNumber} is not available (currently ${room.status})`);
  }

  applyStatus(room, ROOM_STATUSES.RESERVED, { note, actorId });
  await room.save();
  return room;
};

/** Guest arrives: reserved -> occupied. */
export const checkInRoom = async (id, { actorId = null, note } = {}) => {
  const room = await findRoomOrFail(id);

  if (room.status !== ROOM_STATUSES.RESERVED) {
    throw new ApiError(409, `Room ${room.roomNumber} is not reserved (currently ${room.status})`);
  }

  applyStatus(room, ROOM_STATUSES.OCCUPIED, { note, actorId });
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

  const nextStatus = RELEASE_STATUS[room.status];

  if (!nextStatus) {
    return room;
  }

  applyStatus(room, nextStatus, { note: note ?? "", actorId });
  await room.save();
  return room;
};
