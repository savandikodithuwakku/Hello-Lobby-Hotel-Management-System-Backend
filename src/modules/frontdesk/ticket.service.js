import ApiError from "../../shared/utils/ApiError.js";
import { toId } from "../../shared/utils/id.util.js";
import { paginateQuery } from "../../shared/utils/pagination.util.js";
import { containsInsensitive, humanise } from "../../shared/utils/text.util.js";
import { PERMISSIONS, getRolePermissions } from "../auth/rbac/index.js";
import { AUDIT_ACTIONS, AUDIT_ENTITIES } from "../audit/audit.constants.js";
import { recordAudit, recordUpdate } from "../audit/audit.service.js";
import User from "../user/user.model.js";
import { USER_ROLES, USER_STATUSES } from "../user/user.constants.js";
import Room from "../room/room.model.js";
import { HOUSEKEEPING_STATUSES } from "../room/room.constants.js";
import { changeHousekeepingStatus } from "../room/room.service.js";
import Reservation from "../reservation/reservation.model.js";
import Ticket, { generateTicketReference } from "./ticket.model.js";
import {
  ACTIVE_TICKET_STATUSES,
  DEFAULT_TICKET_SORT,
  POLICY,
  PRIORITY_RANK,
  RESOLUTION_REQUIRED_STATUSES,
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  canBlockRoom,
  canTransitionTicket,
  getAllowedTicketTransitions,
} from "./ticket.constants.js";

const withRelations = (query) =>
  query
    .populate("guest", "name email")
    .populate("reportedBy", "name email")
    .populate("assignedTo", "name email")
    .populate("room", "roomNumber floor")
    .populate("reservation", "reference");

/* -------------------------------------------------------------------------- */
/* Access                                                                     */
/*                                                                            */
/* A guest may raise a ticket and follow their own, and nothing else. As        */
/* everywhere else in this system that is done by narrowing the query rather   */
/* than by a second set of endpoints.                                          */
/* -------------------------------------------------------------------------- */

const canManage = (viewer) => Boolean(viewer?.hasPermission(PERMISSIONS.FRONTDESK_TICKET_MANAGE));

const assertCanView = (viewer, ticket) => {
  if (canManage(viewer)) return;

  const ownerId = toId(ticket.guest);
  const reporterId = toId(ticket.reportedBy);

  const isTheirs =
    (ownerId && viewer._id.equals(ownerId)) || (reporterId && viewer._id.equals(reporterId));

  if (!isTheirs) {
    // 404 rather than 403, so a guest cannot probe which tickets exist.
    throw new ApiError(404, "Ticket not found");
  }
};

const findTicketOrFail = async (id) => {
  const ticket = await withRelations(Ticket.findById(id));

  if (!ticket) throw new ApiError(404, "Ticket not found");

  return ticket;
};

const auditEntity = (ticket) => ({
  type: AUDIT_ENTITIES.TICKET,
  id: ticket._id,
  label: ticket.reference,
});

/* -------------------------------------------------------------------------- */
/* The room a ticket can take out of service                                  */
/*                                                                            */
/* "The air conditioner isn't working" and "room 501 cannot be sold" are the   */
/* same fact. Tying them together here means a room is handed back the moment  */
/* the ticket is resolved, instead of staying blocked because everyone forgot. */
/* -------------------------------------------------------------------------- */

const blockRoom = async (ticket, actor) => {
  const room = await Room.findById(toId(ticket.room));

  if (!room) return;

  if (room.housekeeping === HOUSEKEEPING_STATUSES.OUT_OF_ORDER) return;

  await changeHousekeepingStatus(actor, room._id, {
    housekeeping: HOUSEKEEPING_STATUSES.OUT_OF_ORDER,
    note: `${ticket.reference}: ${ticket.subject}`,
  });
};

const releaseRoom = async (ticket, actor) => {
  const room = await Room.findById(toId(ticket.room));

  if (!room || room.housekeeping !== HOUSEKEEPING_STATUSES.OUT_OF_ORDER) return;

  // Back through cleaning rather than straight to sellable: a room that has
  // just been worked on is checked before a guest is sent to it.
  await changeHousekeepingStatus(actor, room._id, {
    housekeeping: HOUSEKEEPING_STATUSES.CLEANING,
    note: `${ticket.reference} resolved`,
  });
};

/* -------------------------------------------------------------------------- */
/* Raising one                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Works out who the ticket is for and which room it is about.
 *
 * A guest may only raise a ticket about their own stay, and the room is taken
 * from that stay rather than accepted from the request - otherwise a guest
 * could report a fault in somebody else's room and have it taken out of
 * service. Staff may raise a ticket about any room, with or without a guest.
 */
const resolveSubject = async (actor, payload) => {
  if (canManage(actor)) {
    const guest = payload.guest ? await User.findById(payload.guest) : null;

    if (payload.guest && !guest) {
      throw new ApiError(404, "The selected guest does not exist");
    }

    const reservation = payload.reservation
      ? await Reservation.findById(payload.reservation)
      : null;

    if (payload.reservation && !reservation) {
      throw new ApiError(404, "The selected reservation does not exist");
    }

    const roomId = payload.room ?? (reservation ? toId(reservation.room) : null);

    if (roomId && !(await Room.exists({ _id: roomId }))) {
      throw new ApiError(404, "The selected room does not exist");
    }

    return {
      guest: guest?._id ?? (reservation ? toId(reservation.customer) : null),
      reservation: reservation?._id ?? null,
      room: roomId,
    };
  }

  // A guest. The stay has to be theirs, and everything else follows from it.
  if (!payload.reservation) {
    throw new ApiError(400, "Say which of your bookings this is about");
  }

  const reservation = await Reservation.findById(payload.reservation);

  if (!reservation || !actor._id.equals(toId(reservation.customer))) {
    throw new ApiError(404, "Reservation not found");
  }

  return {
    guest: actor._id,
    reservation: reservation._id,
    room: toId(reservation.room),
  };
};

export const createTicket = async (actor, payload) => {
  const subject = await resolveSubject(actor, payload);

  const ticket = new Ticket({
    reference: generateTicketReference(),
    subject: payload.subject,
    description: payload.description,
    category: payload.category || TICKET_CATEGORIES.OTHER,
    // A guest cannot mark their own ticket urgent - that is a judgement the
    // hotel makes, and a priority queue everyone can jump is not a queue.
    priority: canManage(actor)
      ? payload.priority || TICKET_PRIORITIES.MEDIUM
      : TICKET_PRIORITIES.MEDIUM,
    status: TICKET_STATUSES.OPEN,
    ...subject,
    reportedBy: actor._id,
    createdBy: actor._id,
    updatedBy: actor._id,
  });

  ticket.applyResponseTarget();
  ticket.recordUpdate("Ticket raised", { by: actor._id, status: TICKET_STATUSES.OPEN });

  await ticket.save();

  // Taking the room out of service is a staff decision, never a guest's.
  if (payload.blocksRoom && canManage(actor)) {
    if (!canBlockRoom(ticket.category)) {
      throw new ApiError(
        400,
        `A ${humanise(ticket.category)} ticket cannot take a room out of service`
      );
    }

    if (!ticket.room) {
      throw new ApiError(400, "This ticket is not about a room, so no room can be blocked");
    }

    ticket.blocksRoom = true;
    await ticket.save();
    await blockRoom(ticket, actor);
  }

  await recordAudit({
    action: AUDIT_ACTIONS.TICKET_CREATED,
    entity: auditEntity(ticket),
    actor,
    description: `Raised ${humanise(ticket.priority)} ${humanise(ticket.category)} ticket: ${ticket.subject}`,
  });

  return getTicketById(ticket._id, actor);
};

/* -------------------------------------------------------------------------- */
/* Reading                                                                    */
/* -------------------------------------------------------------------------- */

export const listTickets = async (query, viewer) => {
  const {
    page,
    limit,
    search,
    status,
    category,
    priority,
    room,
    guest,
    assignedTo,
    active,
    overdue,
    unassigned,
    sort = DEFAULT_TICKET_SORT,
  } = query;

  const filter = {};

  if (canManage(viewer)) {
    if (guest) filter.guest = guest;
    if (assignedTo) filter.assignedTo = assignedTo;
  } else {
    // A guest sees the tickets they raised or that are about their stay.
    filter.$or = [{ guest: viewer._id }, { reportedBy: viewer._id }];
  }

  if (status) filter.status = status;
  if (category) filter.category = category;
  if (priority) filter.priority = priority;
  if (room) filter.room = room;

  if (active === true) filter.status = filter.status || { $in: ACTIVE_TICKET_STATUSES };
  if (unassigned === true) filter.assignedTo = null;

  // Late means nobody has picked it up yet and the target has passed - the same
  // rule as `isTicketOverdue`, expressed as a query.
  if (overdue === true) {
    filter.status = TICKET_STATUSES.OPEN;
    filter.respondBy = { $lt: new Date() };
  }

  if (search) {
    const pattern = containsInsensitive(search);
    const clause = { $or: [{ reference: pattern }, { subject: pattern }] };
    filter.$and = [...(filter.$and || []), clause];
  }

  const { documents, pagination } = await paginateQuery(Ticket, filter, {
    page,
    limit,
    sort,
    decorate: withRelations,
  });

  // Priority ordering is applied here rather than in the query: the stored
  // value is a word, so sorting on it in Mongo would give alphabetical order,
  // which would put "high" above "urgent".
  const tickets = documents
    .slice()
    .sort((a, b) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9));

  return { tickets: tickets.map((ticket) => ticket.toSafeObject()), pagination };
};

export const getTicketById = async (id, viewer) => {
  const ticket = await findTicketOrFail(id);
  assertCanView(viewer, ticket);

  return ticket.toSafeObject({
    allowedTransitions: getAllowedTicketTransitions(ticket.status),
  });
};

/** The counts the service board leads with. */
export const getTicketStatistics = async () => {
  const [byStatus, byPriority, overdue, unassigned] = await Promise.all([
    Ticket.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    Ticket.aggregate([
      { $match: { status: { $in: ACTIVE_TICKET_STATUSES } } },
      { $group: { _id: "$priority", count: { $sum: 1 } } },
    ]),
    Ticket.countDocuments({ status: TICKET_STATUSES.OPEN, respondBy: { $lt: new Date() } }),
    Ticket.countDocuments({ status: { $in: ACTIVE_TICKET_STATUSES }, assignedTo: null }),
  ]);

  const tally = (rows, values) => {
    const counts = Object.fromEntries(values.map((value) => [value, 0]));
    rows.forEach((row) => {
      counts[row._id] = row.count;
    });
    return counts;
  };

  const statusCounts = tally(byStatus, Object.values(TICKET_STATUSES));

  return {
    byStatus: statusCounts,
    byPriority: tally(byPriority, Object.values(TICKET_PRIORITIES)),
    active: ACTIVE_TICKET_STATUSES.reduce((sum, status) => sum + statusCounts[status], 0),
    /** Nobody has picked these up and the response target has passed. */
    overdue,
    unassigned,
  };
};

/**
 * The people a ticket can be given to.
 *
 * Its own endpoint rather than the user directory, for two reasons. Somebody
 * who works tickets holds `frontdesk:ticket_manage` but usually not
 * `user:read`, so the directory would be closed to exactly the people who need
 * this list. And "who can be given a ticket" is this module's own question: it
 * means whoever can work one, which is not the same as any particular role.
 *
 * Roles only narrow the query. The permission itself is then checked per
 * account, so a per-user grant or denial is respected rather than assumed away.
 */
export const listAssignableStaff = async () => {
  const roles = Object.values(USER_ROLES).filter((role) =>
    getRolePermissions(role).includes(PERMISSIONS.FRONTDESK_TICKET_MANAGE)
  );

  const candidates = await User.find({
    role: { $in: roles },
    status: USER_STATUSES.ACTIVE,
  }).sort("name");

  return {
    staff: candidates
      .filter((user) => user.hasPermission(PERMISSIONS.FRONTDESK_TICKET_MANAGE))
      .map((user) => ({ id: user._id.toString(), name: user.name, role: user.role })),
  };
};

/* -------------------------------------------------------------------------- */
/* Working on one                                                             */
/* -------------------------------------------------------------------------- */

export const updateTicket = async (actor, id, payload) => {
  const ticket = await findTicketOrFail(id);

  const before = {
    subject: ticket.subject,
    description: ticket.description,
    category: ticket.category,
    priority: ticket.priority,
  };

  if (payload.subject !== undefined) ticket.subject = payload.subject;
  if (payload.description !== undefined) ticket.description = payload.description;
  if (payload.category !== undefined) ticket.category = payload.category;

  if (payload.priority !== undefined && payload.priority !== ticket.priority) {
    ticket.priority = payload.priority;
    // A ticket escalated to urgent gets an urgent target from this moment, not
    // from when it was raised - otherwise it would be born already late.
    ticket.applyResponseTarget();
  }

  ticket.updatedBy = actor._id;
  await ticket.save();

  await recordUpdate({
    action: AUDIT_ACTIONS.TICKET_UPDATED,
    entity: auditEntity(ticket),
    actor,
    before,
    after: {
      subject: ticket.subject,
      description: ticket.description,
      category: ticket.category,
      priority: ticket.priority,
    },
    description: `Edited ticket ${ticket.reference}`,
  });

  return getTicketById(ticket._id, actor);
};

/** Hands a ticket to somebody, or takes it back off them. */
export const assignTicket = async (actor, id, { assignedTo }) => {
  const ticket = await findTicketOrFail(id);

  const assignee = assignedTo ? await User.findById(assignedTo) : null;

  if (assignedTo && !assignee) {
    throw new ApiError(404, "That member of staff does not exist");
  }

  if (assignee && !assignee.hasPermission(PERMISSIONS.FRONTDESK_TICKET_MANAGE)) {
    throw new ApiError(400, `${assignee.name} cannot be given tickets to work on`);
  }

  const previous = ticket.assignedTo;

  ticket.assignedTo = assignee?._id ?? null;
  ticket.updatedBy = actor._id;
  ticket.recordUpdate(assignee ? `Assigned to ${assignee.name}` : "Unassigned", {
    by: actor._id,
  });

  await ticket.save();

  await recordAudit({
    action: AUDIT_ACTIONS.TICKET_ASSIGNED,
    entity: auditEntity(ticket),
    actor,
    description: assignee
      ? `Gave ticket ${ticket.reference} to ${assignee.name}`
      : `Took ticket ${ticket.reference} off its assignee`,
    changes: [
      {
        field: "assignedTo",
        from: previous ? String(toId(previous)) : null,
        to: assignee ? assignee.name : null,
      },
    ],
  });

  return getTicketById(ticket._id, actor);
};

/** Adds a note without changing anything else. */
export const commentOnTicket = async (actor, id, { note }) => {
  const ticket = await findTicketOrFail(id);
  assertCanView(actor, ticket);

  ticket.recordUpdate(note, { by: actor._id });
  ticket.updatedBy = actor._id;
  await ticket.save();

  return getTicketById(ticket._id, actor);
};

/**
 * Moves a ticket along.
 *
 * Resolving one means saying what was actually done - a ticket closed with no
 * explanation tells the next person nothing, and tells the guest less. If the
 * ticket was what was keeping the room out of order, resolving it gives the
 * room back.
 */
export const changeTicketStatus = async (actor, id, { status, note = "", resolution }) => {
  const ticket = await findTicketOrFail(id);

  if (!canTransitionTicket(ticket.status, status)) {
    const allowed = getAllowedTicketTransitions(ticket.status);

    throw new ApiError(
      409,
      allowed.length === 0
        ? `This ticket is ${humanise(ticket.status)} and cannot change further`
        : `A ${humanise(ticket.status)} ticket can only move to: ${allowed.join(", ")}`
    );
  }

  if (RESOLUTION_REQUIRED_STATUSES.includes(status)) {
    const text = String(resolution ?? ticket.resolution ?? "").trim();

    if (!text) {
      throw new ApiError(400, "Say what was done before resolving this ticket");
    }

    if (text.length > POLICY.RESOLUTION_MAX) {
      throw new ApiError(400, "The resolution is too long");
    }

    ticket.resolution = text;
  }

  const from = ticket.status;
  const now = new Date();

  ticket.status = status;

  // The first time anybody picks it up, whichever status they move it to. This
  // is what the response target was measuring, so it is stamped once and never
  // overwritten by a later move.
  if (!ticket.acknowledgedAt && status !== TICKET_STATUSES.CANCELLED) {
    ticket.acknowledgedAt = now;
  }

  if (status === TICKET_STATUSES.RESOLVED) ticket.resolvedAt = now;
  if (status === TICKET_STATUSES.CLOSED) ticket.closedAt = now;
  // Reopening a disputed resolution clears the stamp, so the ticket is honestly
  // unresolved again rather than carrying a date for work that did not hold.
  if (status === TICKET_STATUSES.IN_PROGRESS) ticket.resolvedAt = null;

  ticket.updatedBy = actor._id;
  ticket.recordUpdate(note || `Moved to ${humanise(status)}`, { by: actor._id, status });

  await ticket.save();

  const finished = status === TICKET_STATUSES.RESOLVED || status === TICKET_STATUSES.CANCELLED;

  if (ticket.blocksRoom && finished) {
    await releaseRoom(ticket, actor);
    ticket.blocksRoom = false;
    await ticket.save();
  }

  await recordAudit({
    action: AUDIT_ACTIONS.TICKET_STATUS_CHANGED,
    entity: auditEntity(ticket),
    actor,
    description: `Ticket ${ticket.reference}: ${humanise(from)} to ${humanise(status)}`,
    changes: [{ field: "status", from, to: status }],
    reason: note || ticket.resolution || "",
  });

  return getTicketById(ticket._id, actor);
};

/**
 * Takes the room out of service because of this ticket, or gives it back.
 *
 * Separate from raising the ticket because the decision often comes later: the
 * fault is reported, somebody looks at it, and only then is it clear the room
 * cannot be sold tonight.
 */
export const setRoomBlock = async (actor, id, { blocksRoom }) => {
  const ticket = await findTicketOrFail(id);

  if (!ticket.room) {
    throw new ApiError(400, "This ticket is not about a room");
  }

  if (blocksRoom && !canBlockRoom(ticket.category)) {
    throw new ApiError(
      400,
      `A ${humanise(ticket.category)} ticket cannot take a room out of service`
    );
  }

  if (blocksRoom === ticket.blocksRoom) {
    return getTicketById(ticket._id, actor);
  }

  ticket.blocksRoom = blocksRoom;
  ticket.updatedBy = actor._id;
  ticket.recordUpdate(
    blocksRoom ? "Room taken out of service" : "Room handed back to housekeeping",
    { by: actor._id }
  );

  await ticket.save();

  if (blocksRoom) {
    await blockRoom(ticket, actor);
  } else {
    await releaseRoom(ticket, actor);
  }

  return getTicketById(ticket._id, actor);
};
