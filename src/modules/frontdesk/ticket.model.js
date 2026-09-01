import mongoose from "mongoose";
import { toDateString } from "../../shared/utils/date.util.js";
import {
  POLICY,
  PRIORITY_RANK,
  TICKET_CATEGORY_VALUES,
  TICKET_PRIORITIES,
  TICKET_PRIORITY_VALUES,
  TICKET_STATUSES,
  TICKET_STATUS_VALUES,
  isTicketOverdue,
  responseTargetFor,
} from "./ticket.constants.js";
import { referenceField } from "../../shared/database/schemaFields.js";

/** One thing that happened to the ticket, in order. */
const updateSchema = new mongoose.Schema(
  {
    note: { type: String, trim: true, maxlength: [POLICY.NOTE_MAX, "Note is too long"] },
    /** Set when this update also changed the status. */
    status: { type: String, enum: TICKET_STATUS_VALUES, default: null },
    by: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

/**
 * A guest service ticket.
 *
 * Raised by a guest about their own stay, or by staff on anyone's behalf -
 * somebody reporting a fault at the desk should not have to be the guest whose
 * room it is.
 *
 * The room is recorded separately from the booking on purpose. A fault belongs
 * to the room and outlives the stay: the guest checks out on Friday, and the
 * broken shower is still broken on Saturday.
 */
const ticketSchema = new mongoose.Schema(
  {
    /** Human-readable ticket number, e.g. TKT-20260826-4F7A. */
    reference: referenceField(),
    subject: {
      type: String,
      required: [true, "A ticket needs a subject"],
      trim: true,
      maxlength: [POLICY.SUBJECT_MAX, "Subject is too long"],
    },
    description: {
      type: String,
      required: [true, "Say what the problem is"],
      trim: true,
      maxlength: [POLICY.DESCRIPTION_MAX, "Description is too long"],
    },
    category: {
      type: String,
      enum: TICKET_CATEGORY_VALUES,
      required: true,
      index: true,
    },
    priority: {
      type: String,
      enum: TICKET_PRIORITY_VALUES,
      default: TICKET_PRIORITIES.MEDIUM,
      index: true,
    },
    status: {
      type: String,
      enum: TICKET_STATUS_VALUES,
      default: TICKET_STATUSES.OPEN,
      index: true,
    },

    /** Whose problem it is. Null for something nobody is staying in. */
    guest: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    /** The stay it came up during, when there is one. */
    reservation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Reservation",
      default: null,
      index: true,
    },
    /** The room it is about. Kept even after the guest leaves - see above. */
    room: { type: mongoose.Schema.Types.ObjectId, ref: "Room", default: null, index: true },

    /** Who raised it: the guest themselves, or the member of staff they told. */
    reportedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    /** Who is dealing with it. Null while it is nobody's. */
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },

    /**
     * When somebody should have picked it up by. Set from the priority when the
     * ticket is raised, and again if the priority is changed - a ticket
     * escalated to urgent gets an urgent target from that moment.
     */
    respondBy: { type: Date, required: true, index: true },
    acknowledgedAt: { type: Date, default: null },
    resolvedAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },

    /** What was actually done. Required before a ticket can be resolved. */
    resolution: {
      type: String,
      trim: true,
      maxlength: [POLICY.RESOLUTION_MAX, "Resolution is too long"],
      default: "",
    },

    /**
     * True while this ticket is what is keeping the room out of order.
     *
     * The link between a fault and an unsellable room. Set when somebody
     * decides the room cannot be used, cleared when the ticket is resolved, and
     * it is what lets the room be handed back automatically rather than staying
     * blocked because everyone forgot.
     */
    blocksRoom: { type: Boolean, default: false },

    updates: { type: [updateSchema], default: [] },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

/** The board: open work, most urgent and longest-waiting first. */
ticketSchema.index({ status: 1, priority: 1, createdAt: 1 });
ticketSchema.index({ room: 1, createdAt: -1 });
ticketSchema.index({ guest: 1, createdAt: -1 });

/** Left waiting past its response target. See `isTicketOverdue`. */
ticketSchema.virtual("isOverdue").get(function ticketOverdue() {
  return isTicketOverdue(this);
});

/** How long the guest waited before somebody picked it up, in minutes. */
ticketSchema.virtual("responseMinutes").get(function ticketResponseMinutes() {
  if (!this.acknowledgedAt) return null;
  return Math.round((this.acknowledgedAt.getTime() - this.createdAt.getTime()) / 60000);
});

ticketSchema.virtual("priorityRank").get(function ticketPriorityRank() {
  return PRIORITY_RANK[this.priority] ?? PRIORITY_RANK[TICKET_PRIORITIES.MEDIUM];
});

/** Recalculates the response target from the current priority. */
ticketSchema.methods.applyResponseTarget = function applyResponseTarget(from = new Date()) {
  this.respondBy = new Date(from.getTime() + responseTargetFor(this.priority) * 60000);
  return this;
};

ticketSchema.methods.recordUpdate = function recordUpdate(note, { by = null, status = null } = {}) {
  if (this.updates.length >= POLICY.MAX_UPDATES) {
    // Keeps the newest, because a long-running ticket's recent history is what
    // anyone picking it up actually needs.
    this.updates.shift();
  }

  this.updates.push({ note, status, by, at: new Date() });
  return this;
};

const person = (value) =>
  value && value.name !== undefined
    ? { id: value._id.toString(), name: value.name, email: value.email ?? null }
    : { id: value?.toString() ?? null };

ticketSchema.methods.toSafeObject = function toSafeObject(extra = {}) {
  const room = this.room && this.room.roomNumber !== undefined ? this.room : null;

  return {
    id: this._id.toString(),
    reference: this.reference,
    subject: this.subject,
    description: this.description,
    category: this.category,
    priority: this.priority,
    status: this.status,

    guest: person(this.guest),
    reportedBy: person(this.reportedBy),
    assignedTo: this.assignedTo ? person(this.assignedTo) : null,

    reservation:
      this.reservation && this.reservation.reference !== undefined
        ? { id: this.reservation._id.toString(), reference: this.reservation.reference }
        : { id: this.reservation?.toString() ?? null },

    room: room
      ? { id: room._id.toString(), roomNumber: room.roomNumber, floor: room.floor }
      : { id: this.room?.toString() ?? null },

    respondBy: this.respondBy,
    isOverdue: this.isOverdue,
    responseMinutes: this.responseMinutes,
    acknowledgedAt: this.acknowledgedAt,
    resolvedAt: this.resolvedAt,
    closedAt: this.closedAt,
    resolution: this.resolution,
    blocksRoom: this.blocksRoom,

    updates: this.updates.map((update) => ({
      note: update.note,
      status: update.status,
      at: update.at,
      by: person(update.by),
    })),

    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
    ...extra,
  };
};

/** Ticket number, in the same shape as booking and invoice references. */
export const generateTicketReference = (date = new Date()) => {
  const stamp = toDateString(date).replace(/-/g, "");
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `TKT-${stamp}-${random}`;
};

export const Ticket = mongoose.model("Ticket", ticketSchema);
export default Ticket;
