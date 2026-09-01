import ApiError from "../../shared/utils/ApiError.js";
import { toId } from "../../shared/utils/id.util.js";
import { toDateString } from "../../shared/utils/date.util.js";
import { PERMISSIONS } from "../auth/rbac/index.js";
import { AUDIT_ACTIONS, AUDIT_ENTITIES } from "../audit/audit.constants.js";
import { recordAudit } from "../audit/audit.service.js";
import Room from "../room/room.model.js";
import {
  HOUSEKEEPING_STATUS_VALUES,
  OCCUPANCY_STATUSES,
  SELLABLE_HOUSEKEEPING,
} from "../room/room.constants.js";
import Reservation from "../reservation/reservation.model.js";
import { RESERVATION_STATUSES, addDays, today } from "../reservation/reservation.constants.js";
import {
  checkInReservation,
  checkOutReservation,
  completeReservation,
  getReservationById,
} from "../reservation/reservation.service.js";
import { resolveInvoice } from "../payment/payment.service.js";
import {
  BOARD_DAYS_AHEAD,
  CHECK_IN_BLOCKERS,
  CHECK_OUT_BLOCKERS,
  OVERRIDE_REASON_MIN,
  isOverridable,
} from "./frontdesk.constants.js";

/* -------------------------------------------------------------------------- */
/* The board                                                                  */
/* -------------------------------------------------------------------------- */

const withBoardRelations = (query) =>
  query
    .populate("customer", "name email phone")
    .populate("room", "roomNumber floor occupancy housekeeping")
    .populate("roomType", "name maxOccupancy");

/**
 * Everything the desk needs to see at a glance: who is arriving today, who is
 * leaving, and who is in the building right now.
 *
 * Arrivals are ordered by how ready they are rather than by name, so the
 * bookings somebody has to do something about sit at the top of the list.
 */
export const getBoard = async (viewer) => {
  const start = today();
  const end = addDays(start, BOARD_DAYS_AHEAD);

  const [arrivals, departures, inHouse] = await Promise.all([
    withBoardRelations(
      Reservation.find({
        status: RESERVATION_STATUSES.CONFIRMED,
        checkIn: { $lt: end },
      }).sort("checkIn")
    ),
    withBoardRelations(
      Reservation.find({
        status: RESERVATION_STATUSES.CHECKED_IN,
        checkOut: { $lt: end },
      }).sort("checkOut")
    ),
    withBoardRelations(
      Reservation.find({ status: RESERVATION_STATUSES.CHECKED_IN }).sort("room")
    ),
  ]);

  // Each arrival is run through the same checks the actual check-in will run,
  // so the desk sees the reason before the guest is standing in front of them
  // rather than finding out at the moment they press the button.
  const arrivalRows = await Promise.all(
    arrivals.map(async (reservation) => {
      const readiness = await assessCheckIn(reservation, viewer);

      return {
        reservation: reservation.toSafeObject(),
        ready: readiness.ready,
        blockers: readiness.blockers,
      };
    })
  );

  const departureRows = await Promise.all(
    departures.map(async (reservation) => {
      const readiness = await assessCheckOut(reservation, viewer);

      return {
        reservation: reservation.toSafeObject(),
        ready: readiness.ready,
        blockers: readiness.blockers,
        balanceDue: readiness.balanceDue,
      };
    })
  );

  return {
    date: toDateString(start),
    arrivals: arrivalRows.sort((a, b) => Number(a.ready) - Number(b.ready)),
    departures: departureRows.sort((a, b) => Number(a.ready) - Number(b.ready)),
    inHouse: inHouse.map((reservation) => reservation.toSafeObject()),
    counts: {
      arrivals: arrivalRows.length,
      arrivalsBlocked: arrivalRows.filter((row) => !row.ready).length,
      departures: departureRows.length,
      departuresBlocked: departureRows.filter((row) => !row.ready).length,
      inHouse: inHouse.length,
    },
  };
};

/* -------------------------------------------------------------------------- */
/* Arrival                                                                    */
/* -------------------------------------------------------------------------- */

const blocker = (code, message, { overridable = false, ...rest } = {}) => ({
  code,
  message,
  overridable,
  ...rest,
});

/**
 * Runs every condition for an arrival and reports all of them at once.
 *
 * Deliberately not written as a series of early throws: a guest whose booking
 * is unconfirmed *and* unpaid should be told both things in one go, so the desk
 * can sort it out in a single conversation instead of discovering the next
 * problem each time they try again.
 */
export const assessCheckIn = async (reservation, viewer) => {
  const blockers = [];

  if (reservation.status !== RESERVATION_STATUSES.CONFIRMED) {
    blockers.push(
      blocker(
        CHECK_IN_BLOCKERS.NOT_CONFIRMED,
        `This booking is ${reservation.status.replace(/_/g, " ")}, not confirmed`
      )
    );
  }

  if (reservation.checkIn > today()) {
    blockers.push(
      blocker(
        CHECK_IN_BLOCKERS.TOO_EARLY,
        `This booking starts on ${toDateString(reservation.checkIn)}`
      )
    );
  }

  const room = await Room.findById(toId(reservation.room));

  if (!room) {
    blockers.push(blocker(CHECK_IN_BLOCKERS.ROOM_UNAVAILABLE, "The room no longer exists"));
  } else {
    // Housekeeping gates the arrival and nothing else. A dirty room can be sold
    // for a future date; nobody may be handed the key to one today.
    if (!SELLABLE_HOUSEKEEPING.includes(room.housekeeping)) {
      blockers.push(
        blocker(
          CHECK_IN_BLOCKERS.ROOM_NOT_READY,
          `Room ${room.roomNumber} is ${room.housekeeping} and is not ready for a guest`
        )
      );
    }

    if (room.occupancy === OCCUPANCY_STATUSES.OCCUPIED) {
      blockers.push(
        blocker(
          CHECK_IN_BLOCKERS.ROOM_UNAVAILABLE,
          `Room ${room.roomNumber} still has a guest in it`
        )
      );
    }
  }

  // The bill is issued on first use, so this both checks the advance and makes
  // sure the booking has an invoice by the time the guest is in the building.
  const invoice = await resolveInvoice({ reservationId: reservation._id }, viewer);

  if (!invoice.advanceSettled) {
    blockers.push(
      blocker(
        CHECK_IN_BLOCKERS.ADVANCE_UNPAID,
        `The advance of ${invoice.amounts.advance} ${invoice.currency} has not been paid ` +
          `(${invoice.netPaid} received)`,
        { overridable: true, outstanding: invoice.amounts.advance - invoice.netPaid }
      )
    );
  }

  return { ready: blockers.length === 0, blockers, invoice, room };
};

/** Read-only: what would happen if the desk pressed check in right now. */
export const previewCheckIn = async (reservationId, viewer) => {
  const reservation = await Reservation.findById(reservationId);

  if (!reservation) throw new ApiError(404, "Reservation not found");

  const { ready, blockers, invoice } = await assessCheckIn(reservation, viewer);

  return {
    reservation: await getReservationById(reservation._id, viewer),
    invoice: invoice.toSafeObject(),
    ready,
    blockers,
  };
};

/**
 * The guest has arrived.
 *
 * Every condition has to pass, except that a manager holding the override
 * permission may let an unpaid advance through by giving a reason. The
 * override is recorded in the audit log against the booking - which is the
 * whole point of allowing it rather than pretending it never happens.
 */
export const checkIn = async (actor, reservationId, { note = "", override } = {}) => {
  const reservation = await Reservation.findById(reservationId);

  if (!reservation) throw new ApiError(404, "Reservation not found");

  const { blockers, invoice } = await assessCheckIn(reservation, actor);

  const wantsOverride = Boolean(override?.reason);
  const remaining = wantsOverride ? blockers.filter((entry) => !isOverridable(entry.code)) : blockers;

  if (remaining.length > 0) {
    throw new ApiError(409, remaining.map((entry) => entry.message).join(". "));
  }

  const overridden = wantsOverride ? blockers.filter((entry) => isOverridable(entry.code)) : [];

  if (overridden.length > 0) {
    if (!actor.hasPermission(PERMISSIONS.FRONTDESK_OVERRIDE_PAYMENT)) {
      throw new ApiError(403, "Only a manager can check a guest in before the advance is paid");
    }

    if (String(override.reason).trim().length < OVERRIDE_REASON_MIN) {
      throw new ApiError(
        400,
        `Give a real reason for the override - at least ${OVERRIDE_REASON_MIN} characters`
      );
    }
  }

  const result = await checkInReservation(actor, reservation._id, { note });

  // Recorded after the arrival succeeds, so the log never claims an override
  // was used on a check-in that was then refused for some other reason.
  for (const entry of overridden) {
    await recordAudit({
      action: AUDIT_ACTIONS.FRONTDESK_OVERRIDE,
      entity: {
        type: AUDIT_ENTITIES.RESERVATION,
        id: reservation._id,
        label: reservation.reference,
      },
      actor,
      description: `Checked in ${reservation.reference} despite: ${entry.message}`,
      changes: [{ field: "blocker", from: entry.code, to: "overridden" }],
      reason: String(override.reason).trim(),
    });
  }

  return {
    reservation: result,
    invoice: (await resolveInvoice({ reservationId: reservation._id }, actor)).toSafeObject(),
    overridden: overridden.map((entry) => entry.code),
  };
};

/* -------------------------------------------------------------------------- */
/* Departure                                                                  */
/* -------------------------------------------------------------------------- */

export const assessCheckOut = async (reservation, viewer) => {
  const blockers = [];

  if (reservation.status !== RESERVATION_STATUSES.CHECKED_IN) {
    blockers.push(
      blocker(
        CHECK_OUT_BLOCKERS.NOT_CHECKED_IN,
        `This booking is ${reservation.status.replace(/_/g, " ")}, so there is nobody to check out`
      )
    );
  }

  const invoice = await resolveInvoice({ reservationId: reservation._id }, viewer);

  // The balance here already includes anything charged to the room during the
  // stay, because the folio is posted to this same invoice.
  if (!invoice.fullySettled) {
    blockers.push(
      blocker(
        CHECK_OUT_BLOCKERS.BALANCE_OUTSTANDING,
        `${invoice.balanceDue} ${invoice.currency} is still outstanding`
      )
    );
  }

  return {
    ready: blockers.length === 0,
    blockers,
    invoice,
    balanceDue: invoice.balanceDue,
  };
};

/** Read-only: the final bill, and whether the guest can leave. */
export const previewCheckOut = async (reservationId, viewer) => {
  const reservation = await Reservation.findById(reservationId);

  if (!reservation) throw new ApiError(404, "Reservation not found");

  const { ready, blockers, invoice, balanceDue } = await assessCheckOut(reservation, viewer);

  return {
    reservation: await getReservationById(reservation._id, viewer),
    invoice: invoice.toSafeObject(),
    ready,
    blockers,
    balanceDue,
  };
};

/**
 * The guest is leaving.
 *
 * Nothing outstanding may be left behind: the stay, everything charged to the
 * room during it, and any extras added at the desk all have to be settled
 * first. There is no override here - an unpaid balance at the door is a debt,
 * not a judgement call, and letting it through would leave the hotel chasing it
 * with no record of who allowed it.
 *
 * The room is left dirty on the way out, which is what puts it on the
 * housekeeping board without anyone having to remember.
 */
export const checkOut = async (actor, reservationId, { note = "" } = {}) => {
  const reservation = await Reservation.findById(reservationId);

  if (!reservation) throw new ApiError(404, "Reservation not found");

  const { ready, blockers, invoice } = await assessCheckOut(reservation, actor);

  if (!ready) {
    throw new ApiError(409, blockers.map((entry) => entry.message).join(". "));
  }

  await checkOutReservation(actor, reservation._id, { note });

  // Nothing is owed, so there is nothing left to wait for: the booking closes
  // in the same breath rather than sitting checked-out until somebody
  // remembers to finish it off.
  const completed = await completeReservation(actor, reservation._id, {
    note: "Settled in full at check-out",
  });

  return { reservation: completed, invoice: invoice.toSafeObject() };
};

/* -------------------------------------------------------------------------- */
/* Housekeeping                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The housekeeping board: every room grouped by what needs doing to it.
 *
 * The number worth looking at is `discrepant` - rooms standing empty that are
 * not fit to sell. Every one of those is a room the hotel could be selling
 * tonight and is not, and it is only visible because occupancy and housekeeping
 * are separate facts.
 */
export const getHousekeepingBoard = async ({ floor } = {}) => {
  const filter = { isActive: true };
  if (floor !== undefined) filter.floor = floor;

  const rooms = await Room.find(filter)
    .populate("roomType", "name")
    .sort("floor roomNumber");

  const byHousekeeping = Object.fromEntries(
    HOUSEKEEPING_STATUS_VALUES.map((status) => [status, []])
  );

  let discrepant = 0;

  rooms.forEach((room) => {
    byHousekeeping[room.housekeeping].push({
      id: room._id.toString(),
      roomNumber: room.roomNumber,
      floor: room.floor,
      roomType: room.roomType?.name ?? null,
      occupancy: room.occupancy,
      housekeeping: room.housekeeping,
      housekeepingNote: room.housekeepingNote,
      housekeepingChangedAt: room.housekeepingChangedAt,
      /** Empty, and not fit to sell. */
      discrepant: room.isDiscrepant(),
    });

    if (room.isDiscrepant()) discrepant += 1;
  });

  return {
    total: rooms.length,
    discrepant,
    counts: Object.fromEntries(
      Object.entries(byHousekeeping).map(([status, list]) => [status, list.length])
    ),
    byHousekeeping,
  };
};
