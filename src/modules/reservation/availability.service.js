import ApiError from "../../shared/utils/ApiError.js";
import Room from "../room/room.model.js";
import RoomType from "../room/roomType.model.js";
import Reservation from "./reservation.model.js";
import {
  BLOCKING_STATUSES,
  NON_BOOKABLE_ROOM_STATUSES,
  POLICY,
  nightsBetween,
  toDateOnly,
  today,
} from "./reservation.constants.js";

/**
 * Availability, and the double-booking rule it exists to enforce.
 *
 *   requested dates
 *        ↓
 *   rooms that physically exist and can be sold   (active, not under
 *        ↓                                         maintenance, type active)
 *   rooms big enough for the party                (type maxOccupancy)
 *        ↓
 *   minus rooms with a live booking that overlaps (the overlap rule below)
 *        ↓
 *   available rooms
 *
 * The overlap rule, and the single most important line in this module:
 *
 *     existing.checkIn < requested.checkOut && existing.checkOut > requested.checkIn
 *
 * Stays are half-open intervals of whole nights. A guest leaving on the 10th
 * frees the room for a guest arriving on the 10th, so touching ranges do not
 * count as a clash - only genuinely shared nights do.
 */

/** Validates and normalises a requested date range. */
export const normaliseStay = ({ checkIn, checkOut }) => {
  const start = toDateOnly(checkIn);
  const end = toDateOnly(checkOut);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new ApiError(400, "Check-in and check-out must be valid dates");
  }

  const nights = nightsBetween(start, end);

  if (nights < 1) {
    throw new ApiError(400, "Check-out must be at least one night after check-in");
  }

  if (nights > POLICY.MAX_NIGHTS) {
    throw new ApiError(400, `A single reservation cannot exceed ${POLICY.MAX_NIGHTS} nights`);
  }

  if (start < today()) {
    throw new ApiError(400, "Check-in cannot be in the past");
  }

  if (nightsBetween(today(), start) > POLICY.MAX_ADVANCE_DAYS) {
    throw new ApiError(400, `Bookings can be made up to ${POLICY.MAX_ADVANCE_DAYS} days ahead`);
  }

  return { checkIn: start, checkOut: end, nights };
};

/**
 * The overlap query itself, shared by every availability check so the rule
 * exists in exactly one place.
 */
const overlapFilter = ({ checkIn, checkOut, rooms, excludeReservationId }) => {
  const filter = {
    status: { $in: BLOCKING_STATUSES },
    checkIn: { $lt: checkOut },
    checkOut: { $gt: checkIn },
  };

  if (rooms) filter.room = Array.isArray(rooms) ? { $in: rooms } : rooms;
  // When editing a booking, its own dates must not be treated as a clash.
  if (excludeReservationId) filter._id = { $ne: excludeReservationId };

  return filter;
};

export const findConflicts = ({ checkIn, checkOut, rooms, excludeReservationId }) =>
  Reservation.find(overlapFilter({ checkIn, checkOut, rooms, excludeReservationId }));

/** Rooms that cannot be sold at all, regardless of dates. */
const nonBookableRoomFilter = () => ({
  isActive: true,
  status: { $nin: NON_BOOKABLE_ROOM_STATUSES },
});

/**
 * Every room free for the whole requested range.
 *
 * Note what is *not* consulted: whether the room happens to be occupied right
 * now. A room with a guest in it today is perfectly bookable for next month -
 * that is decided by the existing reservations, not by the live status. Only a
 * room withdrawn from service or under maintenance is excluded outright.
 */
export const findAvailableRooms = async ({
  checkIn,
  checkOut,
  roomType,
  guests,
  floor,
  excludeReservationId,
}) => {
  const stay = normaliseStay({ checkIn, checkOut });

  const roomFilter = nonBookableRoomFilter();
  if (floor !== undefined) roomFilter.floor = floor;

  // A party of four cannot be sold a room that sleeps two.
  const typeFilter = { isActive: true };
  if (guests !== undefined) typeFilter.maxOccupancy = { $gte: guests };

  const sellableTypeIds = await RoomType.find(typeFilter).distinct("_id");

  roomFilter.roomType = roomType
    ? { $in: sellableTypeIds.filter((id) => id.equals(roomType)) }
    : { $in: sellableTypeIds };

  const candidates = await Room.find(roomFilter)
    .populate("roomType", "name basePrice maxOccupancy facilities isActive")
    .sort("roomNumber");

  if (candidates.length === 0) {
    return { ...stay, rooms: [], total: 0 };
  }

  const conflicts = await findConflicts({
    checkIn: stay.checkIn,
    checkOut: stay.checkOut,
    rooms: candidates.map((room) => room._id),
    excludeReservationId,
  }).select("room");

  const takenRoomIds = new Set(conflicts.map((reservation) => reservation.room.toString()));

  const rooms = candidates
    .filter((room) => !takenRoomIds.has(room._id.toString()))
    .map((room) => ({
      ...room.toSafeObject(),
      /** What this room would cost for the requested stay. */
      quote: {
        nights: stay.nights,
        ratePerNight: room.effectivePrice(),
        roomSubtotal: Math.round(room.effectivePrice() * stay.nights * 100) / 100,
      },
    }));

  return {
    checkIn: stay.checkIn,
    checkOut: stay.checkOut,
    nights: stay.nights,
    rooms,
    total: rooms.length,
    /** How many were ruled out by an existing booking, for the empty state. */
    unavailable: candidates.length - rooms.length,
  };
};

/**
 * Guards a single room for a range. Throws with the reference of the booking
 * that clashes, so the operator knows exactly what is in the way.
 */
export const assertRoomIsAvailable = async ({
  room,
  checkIn,
  checkOut,
  guests,
  excludeReservationId,
}) => {
  const roomDoc = await Room.findById(room).populate(
    "roomType",
    "name basePrice maxOccupancy isActive"
  );

  if (!roomDoc) {
    throw new ApiError(404, "The selected room does not exist");
  }

  if (!roomDoc.isActive) {
    throw new ApiError(409, `Room ${roomDoc.roomNumber} has been removed from the inventory`);
  }

  if (NON_BOOKABLE_ROOM_STATUSES.includes(roomDoc.status)) {
    throw new ApiError(409, `Room ${roomDoc.roomNumber} is ${roomDoc.status} and cannot be booked`);
  }

  if (!roomDoc.roomType?.isActive) {
    throw new ApiError(409, `Room ${roomDoc.roomNumber} belongs to a withdrawn room type`);
  }

  if (guests !== undefined && guests > roomDoc.roomType.maxOccupancy) {
    throw new ApiError(
      409,
      `Room ${roomDoc.roomNumber} sleeps ${roomDoc.roomType.maxOccupancy}; ${guests} guests were requested`
    );
  }

  const conflict = await findConflicts({
    checkIn,
    checkOut,
    rooms: roomDoc._id,
    excludeReservationId,
  })
    .select("reference checkIn checkOut")
    .limit(1);

  if (conflict.length > 0) {
    const clash = conflict[0];
    throw new ApiError(
      409,
      `Room ${roomDoc.roomNumber} is already booked for those dates (${clash.reference}, ` +
        `${clash.checkIn.toISOString().slice(0, 10)} to ${clash.checkOut.toISOString().slice(0, 10)})`
    );
  }

  return roomDoc;
};

/**
 * Second line of defence against a double booking.
 *
 * Two requests can pass `assertRoomIsAvailable` at the same instant and both
 * insert. Immediately after saving, each one looks again: if another live
 * booking overlaps the same room, the one with the higher id stands down. The
 * comparison is deterministic, so exactly one of the pair survives without
 * needing a distributed lock.
 */
export const resolveInsertRace = async (reservation) => {
  const rivals = await findConflicts({
    checkIn: reservation.checkIn,
    checkOut: reservation.checkOut,
    rooms: reservation.room,
    excludeReservationId: reservation._id,
  }).select("_id reference");

  const loser = rivals.find((rival) => rival._id.toString() < reservation._id.toString());

  if (loser) {
    await reservation.deleteOne();
    throw new ApiError(
      409,
      `Room was booked by another request a moment ago (${loser.reference}). Please pick another room.`
    );
  }
};

/**
 * Occupancy for a date range: how many of the sellable rooms are taken each
 * night. Feeds the front-desk board and, later, the analytics module.
 */
export const getOccupancyForRange = async ({ checkIn, checkOut }) => {
  const stay = normaliseStay({ checkIn, checkOut });

  const [sellableRooms, reservations] = await Promise.all([
    Room.countDocuments(nonBookableRoomFilter()),
    findConflicts({ checkIn: stay.checkIn, checkOut: stay.checkOut }).select("checkIn checkOut"),
  ]);

  const nights = [];

  for (let offset = 0; offset < stay.nights; offset += 1) {
    const night = new Date(stay.checkIn);
    night.setUTCDate(night.getUTCDate() + offset);

    const booked = reservations.filter(
      (reservation) => reservation.checkIn <= night && reservation.checkOut > night
    ).length;

    nights.push({
      date: night,
      booked,
      free: Math.max(sellableRooms - booked, 0),
      occupancyRate: sellableRooms === 0 ? 0 : Math.round((booked / sellableRooms) * 100),
    });
  }

  return { sellableRooms, nights };
};
