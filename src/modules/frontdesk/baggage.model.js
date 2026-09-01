import mongoose from "mongoose";
import { toDateString } from "../../shared/utils/date.util.js";
import {
  BAGGAGE_STATUSES,
  LOCATION_MAX,
  POLICY,
  deriveBaggageStatus,
} from "./baggage.constants.js";
import { noteField, referenceField } from "../../shared/database/schemaFields.js";

/**
 * One lot of baggage held at the desk.
 *
 * A record covers everything handed over at once, because that is how it comes
 * back: a guest does not collect two of their three bags. `bagCount` is how
 * many pieces, and the description is what they look like - "two black
 * suitcases and a rucksack" is what actually gets them back to the right
 * person.
 *
 * Nothing is ever deleted. A collected record stays, because "who took those
 * bags, and when" is exactly the question asked when something has gone wrong.
 */
const baggageSchema = new mongoose.Schema(
  {
    /**
     * The number on the ticket handed to the guest.
     *
     * Deliberately not the database id: it has to be short enough to write on a
     * paper tag and read back over a desk.
     */
    tag: referenceField(),

    /** The account, when the person has one. */
    guest: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    /**
     * Written down for somebody with no account - a walk-in, a visitor. One of
     * this and `guest` is always set; the service refuses a record with neither,
     * because baggage nobody is named against cannot be given back.
     */
    guestName: {
      type: String,
      trim: true,
      maxlength: [POLICY.GUEST_NAME_MAX, "Name is too long"],
      default: "",
    },
    /** The stay it belongs to, when there is one. */
    reservation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Reservation",
      default: null,
      index: true,
    },

    bagCount: {
      type: Number,
      required: [true, "Say how many pieces there are"],
      min: [1, "There must be at least one piece"],
      max: [POLICY.MAX_BAGS, "That is more pieces than the desk can take at once"],
    },
    /** What they look like, so the right bags come back out. */
    description: {
      type: String,
      trim: true,
      maxlength: [POLICY.DESCRIPTION_MAX, "Description is too long"],
      default: "",
    },
    /** Where they are: "store room B, shelf 3". */
    location: {
      type: String,
      trim: true,
      maxlength: [LOCATION_MAX, "Location is too long"],
      default: "",
    },

    receivedAt: { type: Date, default: Date.now, index: true },
    receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    /** Set the moment the bags are handed back. Until then, null. */
    collectedAt: { type: Date, default: null },
    collectedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    /**
     * Who actually walked away with them.
     *
     * Usually the guest, sometimes not - a driver, a colleague, a family
     * member. Written down because "somebody collected them" is not an answer
     * when a guest comes back for bags that have gone.
     */
    collectedByName: {
      type: String,
      trim: true,
      maxlength: [POLICY.GUEST_NAME_MAX, "Name is too long"],
      default: "",
    },

    note: noteField(POLICY.NOTE_MAX),

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

/** "What is behind the desk right now", longest-held first. */
baggageSchema.index({ collectedAt: 1, receivedAt: 1 });

/** Worked out from the dates every time - see `deriveBaggageStatus`. */
baggageSchema.virtual("status").get(function baggageStatus() {
  return deriveBaggageStatus({ receivedAt: this.receivedAt, collectedAt: this.collectedAt });
});

baggageSchema.virtual("isCollected").get(function baggageCollected() {
  return Boolean(this.collectedAt);
});

/** How long it has been here, in whole days. */
baggageSchema.virtual("daysHeld").get(function baggageDaysHeld() {
  const until = this.collectedAt ?? new Date();
  return Math.floor((until.getTime() - this.receivedAt.getTime()) / 86_400_000);
});

const person = (value) =>
  value && value.name !== undefined
    ? { id: value._id.toString(), name: value.name, email: value.email ?? null }
    : { id: value?.toString() ?? null };

baggageSchema.methods.toSafeObject = function toSafeObject(extra = {}) {
  const guest = this.guest && this.guest.name !== undefined ? this.guest : null;

  return {
    id: this._id.toString(),
    tag: this.tag,
    status: this.status,

    // One name for the screen to show, whether the person has an account or not.
    guestName: guest?.name || this.guestName,
    guest: this.guest ? person(this.guest) : null,
    reservation:
      this.reservation && this.reservation.reference !== undefined
        ? { id: this.reservation._id.toString(), reference: this.reservation.reference }
        : { id: this.reservation?.toString() ?? null },

    bagCount: this.bagCount,
    description: this.description,
    location: this.location,

    receivedAt: this.receivedAt,
    receivedBy: person(this.receivedBy),
    collectedAt: this.collectedAt,
    collectedBy: this.collectedAt ? person(this.collectedBy) : null,
    collectedByName: this.collectedByName,

    isCollected: this.isCollected,
    daysHeld: this.daysHeld,
    note: this.note,

    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
    ...extra,
  };
};

/**
 * The claim tag: date plus four characters, the same shape as every other
 * reference in the system so it reads as one to a guest.
 */
export const generateBaggageTag = (date = new Date()) => {
  const stamp = toDateString(date).replace(/-/g, "");
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `BAG-${stamp}-${random}`;
};

export const UNCLAIMED = BAGGAGE_STATUSES.UNCLAIMED;

export const Baggage = mongoose.model("Baggage", baggageSchema);
export default Baggage;
