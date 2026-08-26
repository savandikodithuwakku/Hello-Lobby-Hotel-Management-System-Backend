import ApiError from "../../shared/utils/ApiError.js";
import { PERMISSIONS } from "../auth/rbac/permissions.js";
import User from "../user/user.model.js";
import Room from "../room/room.model.js";
import { ROOM_STATUSES } from "../room/room.constants.js";
import { checkInRoom, releaseRoom, reserveRoom } from "../room/room.service.js";
import Reservation, { generateReference } from "./reservation.model.js";
import {
  assertRoomIsAvailable,
  normaliseStay,
  resolveInsertRace,
} from "./availability.service.js";
import {
  CANCELLABLE_STATUSES,
  DEFAULT_PAGE_SIZE,
  DEFAULT_RESERVATION_SORT,
  EDITABLE_STATUSES,
  MAX_PAGE_SIZE,
  POLICY,
  RESERVATION_STATUSES,
  addDays,
  canTransition,
  getAllowedTransitions,
  today,
} from "./reservation.constants.js";

const money = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Populates everything `toSafeObject` needs to render a full reservation. */
const withRelations = (query) =>
  query
    .populate("customer", "name email phone")
    .populate("room", "roomNumber floor status")
    .populate("roomType", "name maxOccupancy");

/* -------------------------------------------------------------------------- */
/* Access                                                                     */
/* -------------------------------------------------------------------------- */

const canReadAll = (viewer) => Boolean(viewer?.hasPermission(PERMISSIONS.RESERVATION_READ));

/**
 * A guest may only ever see their own bookings. Rather than a separate
 * endpoint, the list and detail routes narrow themselves to the caller.
 */
const assertCanView = (viewer, reservation) => {
  if (canReadAll(viewer)) return;

  const ownerId = reservation.customer?._id ?? reservation.customer;

  if (!ownerId || !viewer._id.equals(ownerId)) {
    // 404 rather than 403: a guest should not be able to probe which references exist.
    throw new ApiError(404, "Reservation not found");
  }
};

const findReservationOrFail = async (id) => {
  const reservation = await withRelations(Reservation.findById(id));

  if (!reservation) {
    throw new ApiError(404, "Reservation not found");
  }

  return reservation;
};

/* -------------------------------------------------------------------------- */
/* Room status synchronisation                                                */
/*                                                                            */
/* A room's live status describes *today*. A booking for next month must not   */
/* mark a room reserved now, or the room would look unsellable for every other */
/* date. So the room is only touched when the booking is the one covering the  */
/* current day.                                                               */
/* -------------------------------------------------------------------------- */

const holdRoomIfCurrent = async (reservation, actorId) => {
  if (!reservation.isCurrent()) return;

  const room = await Room.findById(reservation.room?._id ?? reservation.room);

  if (room?.status === ROOM_STATUSES.AVAILABLE) {
    await reserveRoom(room._id, { actorId, note: `Booking ${reservation.reference}` });
  }
};

/**
 * Frees the room when a booking that was holding it ends early (cancellation or
 * a no-show). Module 3 decides where the room lands - straight back to
 * available from reserved, or to cleaning after an occupied stay.
 */
const releaseRoomIfHeld = async (reservation, actorId, note) => {
  const room = await Room.findById(reservation.room?._id ?? reservation.room);

  if (!room) return;

  const heldByThisBooking =
    room.status === ROOM_STATUSES.RESERVED || room.status === ROOM_STATUSES.OCCUPIED;

  if (heldByThisBooking && reservation.isCurrent()) {
    await releaseRoom(room._id, { actorId, note });
  }
};

/* -------------------------------------------------------------------------- */
/* Create                                                                     */
/* -------------------------------------------------------------------------- */

const normaliseServices = (services = []) =>
  services
    .filter((service) => service && String(service.name || "").trim())
    .slice(0, POLICY.MAX_SERVICES)
    .map((service) => ({
      name: String(service.name).trim(),
      unitPrice: money(service.unitPrice),
      quantity: Math.max(1, Math.floor(Number(service.quantity) || 1)),
    }));

/**
 * Resolves who the booking is for. A guest can only book for themselves; staff
 * may book on behalf of any customer.
 */
const resolveCustomer = async (actor, requestedCustomerId) => {
  if (!requestedCustomerId || actor._id.equals(requestedCustomerId)) {
    return actor;
  }

  if (!actor.hasPermission(PERMISSIONS.RESERVATION_READ)) {
    throw new ApiError(403, "You can only make reservations for yourself");
  }

  const customer = await User.findById(requestedCustomerId);

  if (!customer) {
    throw new ApiError(404, "The selected customer does not exist");
  }

  return customer;
};

export const createReservation = async (actor, payload) => {
  const stay = normaliseStay(payload);
  const customer = await resolveCustomer(actor, payload.customer);

  const room = await assertRoomIsAvailable({
    room: payload.room,
    checkIn: stay.checkIn,
    checkOut: stay.checkOut,
    guests: payload.guests,
  });

  const rate = room.effectivePrice();

  if (rate === null) {
    throw new ApiError(409, `Room ${room.roomNumber} has no price set`);
  }

  const reservation = new Reservation({
    reference: generateReference(),
    customer: customer._id,
    room: room._id,
    roomType: room.roomType._id,
    checkIn: stay.checkIn,
    checkOut: stay.checkOut,
    nights: stay.nights,
    guests: payload.guests,
    status: RESERVATION_STATUSES.PENDING,
    pricing: { roomRate: rate, roomSubtotal: 0, servicesSubtotal: 0, totalAmount: 0 },
    additionalServices: normaliseServices(payload.additionalServices),
    payment: {
      advanceAmount: 0,
      amountPaid: 0,
      // The hold lapses if the advance is not in by then - or on arrival day,
      // whichever comes first, since a booking made for tomorrow cannot have
      // two days to pay.
      advanceDeadline: new Date(
        Math.min(
          Date.now() + POLICY.ADVANCE_DEADLINE_HOURS * 3_600_000,
          stay.checkIn.getTime()
        )
      ),
      // The rest is due by arrival.
      balanceDeadline: stay.checkIn,
    },
    specialRequests: payload.specialRequests || "",
    createdBy: actor._id,
    updatedBy: actor._id,
  });

  reservation.recalculateTotals();
  reservation.recordHistory(RESERVATION_STATUSES.PENDING, {
    by: actor._id,
    note: "Reservation created",
  });

  await reservation.save();
  // Two simultaneous bookings can both pass the check above; exactly one survives.
  await resolveInsertRace(reservation);

  await holdRoomIfCurrent(reservation, actor._id);

  return getReservationById(reservation._id, actor);
};

/* -------------------------------------------------------------------------- */
/* Read                                                                       */
/* -------------------------------------------------------------------------- */

export const listReservations = async (query, viewer) => {
  const {
    page = 1,
    limit = DEFAULT_PAGE_SIZE,
    search,
    status,
    customer,
    room,
    roomType,
    from,
    to,
    unpaid,
    sort = DEFAULT_RESERVATION_SORT,
  } = query;

  const filter = {};

  // A guest sees their own bookings and nothing else, whatever they ask for.
  if (canReadAll(viewer)) {
    if (customer) filter.customer = customer;
  } else {
    filter.customer = viewer._id;
  }

  if (status) filter.status = status;
  if (room) filter.room = room;
  if (roomType) filter.roomType = roomType;

  // Stays that touch the window, using the same overlap rule as availability.
  if (from || to) {
    if (to) filter.checkIn = { $lte: new Date(to) };
    if (from) filter.checkOut = { $gte: new Date(from) };
  }

  if (unpaid === true) {
    filter.$expr = { $lt: ["$payment.amountPaid", "$pricing.totalAmount"] };
    filter.status = filter.status || {
      $in: [
        RESERVATION_STATUSES.PENDING,
        RESERVATION_STATUSES.CONFIRMED,
        RESERVATION_STATUSES.CHECKED_IN,
        RESERVATION_STATUSES.CHECKED_OUT,
      ],
    };
  }

  if (search) {
    const pattern = new RegExp(escapeRegex(search), "i");
    // Reference is the common case; a name or email search resolves to ids first.
    const customerIds = await User.find({ $or: [{ name: pattern }, { email: pattern }] }).distinct(
      "_id"
    );
    const roomIds = await Room.find({ roomNumber: pattern }).distinct("_id");

    const or = [{ reference: pattern }, { room: { $in: roomIds } }];
    if (canReadAll(viewer)) or.push({ customer: { $in: customerIds } });

    filter.$and = [...(filter.$and || []), { $or: or }];
  }

  const safeLimit = Math.min(Number(limit) || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const safePage = Math.max(Number(page) || 1, 1);

  const [reservations, total] = await Promise.all([
    withRelations(
      Reservation.find(filter)
        .sort(sort)
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit)
    ),
    Reservation.countDocuments(filter),
  ]);

  return {
    reservations: reservations.map((reservation) => reservation.toSafeObject()),
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.ceil(total / safeLimit) || 1,
    },
  };
};

export const getReservationById = async (id, viewer) => {
  const reservation = await findReservationOrFail(id);
  assertCanView(viewer, reservation);

  return reservation.toSafeObject({
    allowedTransitions: getAllowedTransitions(reservation.status),
  });
};

/** The audit trail: every status change, who made it and why. */
export const getReservationHistory = async (id, viewer) => {
  const reservation = await withRelations(Reservation.findById(id)).populate(
    "history.by",
    "name"
  );

  if (!reservation) {
    throw new ApiError(404, "Reservation not found");
  }

  assertCanView(viewer, reservation);

  return { reference: reservation.reference, history: reservation.toHistoryObject() };
};

/** Front-desk summary: today's arrivals and departures, and what is owed. */
export const getReservationStatistics = async () => {
  const start = today();
  const tomorrow = addDays(start, 1);

  const [byStatus, arrivals, departures, inHouse, outstanding] = await Promise.all([
    Reservation.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    Reservation.countDocuments({
      status: RESERVATION_STATUSES.CONFIRMED,
      checkIn: { $gte: start, $lt: tomorrow },
    }),
    Reservation.countDocuments({
      status: RESERVATION_STATUSES.CHECKED_IN,
      checkOut: { $gte: start, $lt: tomorrow },
    }),
    Reservation.countDocuments({ status: RESERVATION_STATUSES.CHECKED_IN }),
    Reservation.aggregate([
      {
        $match: {
          status: {
            $in: [
              RESERVATION_STATUSES.PENDING,
              RESERVATION_STATUSES.CONFIRMED,
              RESERVATION_STATUSES.CHECKED_IN,
              RESERVATION_STATUSES.CHECKED_OUT,
            ],
          },
          $expr: { $lt: ["$payment.amountPaid", "$pricing.totalAmount"] },
        },
      },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          amount: { $sum: { $subtract: ["$pricing.totalAmount", "$payment.amountPaid"] } },
        },
      },
    ]),
  ]);

  const statusCounts = Object.fromEntries(
    Object.values(RESERVATION_STATUSES).map((status) => [status, 0])
  );
  byStatus.forEach((row) => {
    statusCounts[row._id] = row.count;
  });

  return {
    byStatus: statusCounts,
    arrivalsToday: arrivals,
    departuresToday: departures,
    inHouse,
    outstanding: {
      count: outstanding[0]?.count || 0,
      amount: money(outstanding[0]?.amount || 0),
    },
  };
};

/* -------------------------------------------------------------------------- */
/* Update                                                                     */
/* -------------------------------------------------------------------------- */

export const updateReservation = async (actor, id, payload) => {
  const reservation = await findReservationOrFail(id);
  assertCanView(actor, reservation);

  if (!EDITABLE_STATUSES.includes(reservation.status)) {
    throw new ApiError(
      409,
      `A ${reservation.status.replace("_", " ")} reservation can no longer be edited`
    );
  }

  const datesChanged = payload.checkIn !== undefined || payload.checkOut !== undefined;
  const roomChanged =
    payload.room !== undefined &&
    String(payload.room) !== String(reservation.room?._id ?? reservation.room);
  const guests = payload.guests ?? reservation.guests;

  if (datesChanged || roomChanged || payload.guests !== undefined) {
    const stay = normaliseStay({
      checkIn: payload.checkIn ?? reservation.checkIn,
      checkOut: payload.checkOut ?? reservation.checkOut,
    });

    // The booking's own dates must not count as a clash with itself.
    const room = await assertRoomIsAvailable({
      room: payload.room ?? reservation.room?._id ?? reservation.room,
      checkIn: stay.checkIn,
      checkOut: stay.checkOut,
      guests,
      excludeReservationId: reservation._id,
    });

    reservation.checkIn = stay.checkIn;
    reservation.checkOut = stay.checkOut;
    reservation.nights = stay.nights;
    reservation.guests = guests;
    reservation.payment.balanceDeadline = stay.checkIn;

    if (roomChanged) {
      reservation.room = room._id;
      reservation.roomType = room.roomType._id;
      // A different room means a different nightly rate from here on.
      reservation.pricing.roomRate = room.effectivePrice();
    }
  }

  if (payload.additionalServices !== undefined) {
    reservation.additionalServices = normaliseServices(payload.additionalServices);
  }

  if (payload.specialRequests !== undefined) {
    reservation.specialRequests = payload.specialRequests;
  }

  reservation.recalculateTotals();

  // Repricing must never leave a guest having overpaid without anyone noticing.
  if (reservation.payment.amountPaid > reservation.pricing.totalAmount) {
    throw new ApiError(
      409,
      "The new total is less than what has already been paid. Refund the difference through the payments module first."
    );
  }

  reservation.updatedBy = actor._id;
  await reservation.save();

  return getReservationById(reservation._id, actor);
};

/* -------------------------------------------------------------------------- */
/* Status transitions                                                         */
/* -------------------------------------------------------------------------- */

const assertTransition = (reservation, next) => {
  if (!canTransition(reservation.status, next)) {
    const allowed = getAllowedTransitions(reservation.status);
    throw new ApiError(
      409,
      allowed.length === 0
        ? `This reservation is ${reservation.status.replace("_", " ")} and cannot change further`
        : `A ${reservation.status.replace("_", " ")} reservation can only move to: ${allowed.join(", ")}`
    );
  }
};

const applyTransition = async (reservation, next, { actor, note = "" }) => {
  assertTransition(reservation, next);
  reservation.status = next;
  reservation.updatedBy = actor._id;
  reservation.recordHistory(next, { by: actor._id, note });
  await reservation.save();
};

/** The advance is in, so the room is held for the guest. */
export const confirmReservation = async (actor, id, { note } = {}) => {
  const reservation = await findReservationOrFail(id);

  if (!reservation.advanceSettled) {
    throw new ApiError(
      409,
      `The advance of ${reservation.payment.advanceAmount} must be paid before this reservation can be confirmed ` +
        `(${reservation.payment.amountPaid} received so far)`
    );
  }

  await applyTransition(reservation, RESERVATION_STATUSES.CONFIRMED, { actor, note });
  await holdRoomIfCurrent(reservation, actor._id);

  return getReservationById(reservation._id, actor);
};

export const cancelReservation = async (actor, id, { reason } = {}) => {
  const reservation = await findReservationOrFail(id);
  assertCanView(actor, reservation);

  // A guest may call off their own booking; anyone else needs the permission.
  const isOwner = actor._id.equals(reservation.customer?._id ?? reservation.customer);
  if (!isOwner && !actor.hasPermission(PERMISSIONS.RESERVATION_CANCEL)) {
    throw new ApiError(403, "You do not have permission to cancel this reservation");
  }

  if (!CANCELLABLE_STATUSES.includes(reservation.status)) {
    throw new ApiError(
      409,
      `A ${reservation.status.replace("_", " ")} reservation cannot be cancelled`
    );
  }

  reservation.cancelledAt = new Date();
  reservation.cancellationReason = reason || "";

  await applyTransition(reservation, RESERVATION_STATUSES.CANCELLED, {
    actor,
    note: reason || "Cancelled",
  });

  // The dates are free again the moment this saves - the overlap query only
  // looks at live bookings - and the room itself is released if it was on hold.
  await releaseRoomIfHeld(reservation, actor._id, `Cancelled ${reservation.reference}`);

  return getReservationById(reservation._id, actor);
};

/** The guest never arrived. Keeps the booking on record rather than deleting it. */
export const markNoShow = async (actor, id, { note } = {}) => {
  const reservation = await findReservationOrFail(id);

  if (reservation.checkIn > new Date()) {
    throw new ApiError(409, "This reservation's check-in date has not passed yet");
  }

  await applyTransition(reservation, RESERVATION_STATUSES.NO_SHOW, {
    actor,
    note: note || "Guest did not arrive",
  });
  await releaseRoomIfHeld(reservation, actor._id, `No-show ${reservation.reference}`);

  return getReservationById(reservation._id, actor);
};

export const checkInReservation = async (actor, id, { note } = {}) => {
  const reservation = await findReservationOrFail(id);

  if (reservation.checkIn > today()) {
    throw new ApiError(
      409,
      `This reservation starts on ${reservation.checkIn.toISOString().slice(0, 10)}`
    );
  }

  const room = await Room.findById(reservation.room?._id ?? reservation.room);

  if (!room) {
    throw new ApiError(404, "The room for this reservation no longer exists");
  }

  // A booking made weeks ago has not been holding the room; put it on hold now,
  // then walk it through the same reserved -> occupied path as everything else.
  if (room.status === ROOM_STATUSES.AVAILABLE) {
    await reserveRoom(room._id, { actorId: actor._id, note: `Arrival ${reservation.reference}` });
  } else if (room.status !== ROOM_STATUSES.RESERVED) {
    throw new ApiError(
      409,
      `Room ${room.roomNumber} is ${room.status} and cannot take an arrival right now`
    );
  }

  await applyTransition(reservation, RESERVATION_STATUSES.CHECKED_IN, { actor, note });
  reservation.checkedInAt = new Date();
  await reservation.save();

  await checkInRoom(room._id, { actorId: actor._id, note: `Booking ${reservation.reference}` });

  return getReservationById(reservation._id, actor);
};

export const checkOutReservation = async (actor, id, { note } = {}) => {
  const reservation = await findReservationOrFail(id);

  await applyTransition(reservation, RESERVATION_STATUSES.CHECKED_OUT, { actor, note });
  reservation.checkedOutAt = new Date();
  await reservation.save();

  // Sends the room to housekeeping; it returns to availability once cleaned.
  await releaseRoom(reservation.room?._id ?? reservation.room, {
    actorId: actor._id,
    note: `Departure ${reservation.reference}`,
  });

  return getReservationById(reservation._id, actor);
};

/** Closes the booking once nothing is owed. */
export const completeReservation = async (actor, id, { note } = {}) => {
  const reservation = await findReservationOrFail(id);

  if (!reservation.fullySettled) {
    throw new ApiError(
      409,
      `${reservation.balanceDue} is still outstanding. Settle the balance before completing the reservation.`
    );
  }

  await applyTransition(reservation, RESERVATION_STATUSES.COMPLETED, { actor, note });

  return getReservationById(reservation._id, actor);
};

/* -------------------------------------------------------------------------- */
/* Payment                                                                    */
/*                                                                            */
/* Recording money against a booking lives here because the balance and the    */
/* deadlines are part of the reservation. The payments module will call this   */
/* rather than writing to `payment` itself, so the confirm-on-advance rule     */
/* below stays in one place.                                                   */
/* -------------------------------------------------------------------------- */

export const recordPayment = async (actor, id, { amount, note = "" }) => {
  const reservation = await findReservationOrFail(id);

  const value = money(amount);

  if (value <= 0) {
    throw new ApiError(400, "A payment must be greater than zero");
  }

  if (value > reservation.balanceDue) {
    throw new ApiError(
      400,
      `That is more than the outstanding balance of ${reservation.balanceDue}`
    );
  }

  reservation.payment.amountPaid = money(reservation.payment.amountPaid + value);
  reservation.payment.lastPaymentAt = new Date();
  reservation.updatedBy = actor._id;

  // Paying the advance is what turns a held booking into a confirmed one, so
  // the guest never has to take a second action to secure the room.
  const autoConfirm =
    reservation.status === RESERVATION_STATUSES.PENDING && reservation.advanceSettled;

  if (autoConfirm) {
    reservation.status = RESERVATION_STATUSES.CONFIRMED;
    reservation.recordHistory(RESERVATION_STATUSES.CONFIRMED, {
      by: actor._id,
      note: "Advance received",
    });
  }

  await reservation.save();

  if (autoConfirm) {
    await holdRoomIfCurrent(reservation, actor._id);
  }

  return {
    reservation: await getReservationById(reservation._id, actor),
    recorded: value,
    autoConfirmed: autoConfirm,
    note,
  };
};
