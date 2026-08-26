import mongoose from "mongoose";
import { normaliseFacilities } from "./roomType.model.js";
import {
  HOUSEKEEPING_STATUSES,
  HOUSEKEEPING_STATUS_VALUES,
  IN_USE_OCCUPANCY,
  LIMITS,
  OCCUPANCY_STATUSES,
  OCCUPANCY_STATUS_VALUES,
  isDiscrepant,
  isSellable,
} from "./room.constants.js";

/**
 * A physical room.
 *
 * Most of what a guest sees comes from the room's type; the room itself only
 * carries what is specific to it - its number, floor, its two live statuses,
 * any price that differs from the type's base price, and any extra facilities.
 *
 * The two statuses answer different questions and are kept apart on purpose:
 * `occupancy` says whether anybody is attached to the room and is driven by
 * reservations, while `housekeeping` says whether it is fit to sell and is
 * driven by housekeeping staff. See `room.constants.js` for why.
 *
 * Rooms are never hard-deleted (`isActive: false` instead), so a reservation
 * made against room 205 still resolves after 205 is taken out of the inventory.
 */
const roomSchema = new mongoose.Schema(
  {
    roomNumber: {
      type: String,
      required: [true, "Room number is required"],
      trim: true,
      uppercase: true,
      maxlength: [LIMITS.ROOM_NUMBER_MAX, "Room number is too long"],
    },
    roomType: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RoomType",
      required: [true, "Room type is required"],
      index: true,
    },
    floor: {
      type: Number,
      required: [true, "Floor is required"],
      min: [LIMITS.MIN_FLOOR, "Floor is out of range"],
      max: [LIMITS.MAX_FLOOR, "Floor is out of range"],
      index: true,
    },
    /** Whether anybody holds this room. Set by the reservation and front-desk
     * modules only - never through a room endpoint. */
    occupancy: {
      type: String,
      enum: OCCUPANCY_STATUS_VALUES,
      default: OCCUPANCY_STATUSES.VACANT,
      index: true,
    },
    /** Whether the room is fit to sell. Set by housekeeping only. */
    housekeeping: {
      type: String,
      enum: HOUSEKEEPING_STATUS_VALUES,
      // A new room has not been serviced yet, so it starts needing a clean
      // rather than being quietly presented as ready for a guest.
      default: HOUSEKEEPING_STATUSES.DIRTY,
      index: true,
    },
    /** Why the room is in its current housekeeping state ("deep clean",
     * "AC repair"). Occupancy never needs a note - the booking is the reason. */
    housekeepingNote: {
      type: String,
      trim: true,
      maxlength: [LIMITS.NOTE_MAX, "Note is too long"],
      default: "",
    },
    housekeepingChangedAt: {
      type: Date,
      default: Date.now,
    },
    housekeepingChangedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    occupancyChangedAt: {
      type: Date,
      default: Date.now,
    },
    /**
     * Overrides the type's base price for this room only (a corner suite with
     * a better view). `null` means "whatever the type charges".
     */
    price: {
      type: Number,
      default: null,
      min: [0, "Price cannot be negative"],
      max: [LIMITS.MAX_PRICE, "Price is unrealistically high"],
    },
    /** Extras this room has on top of the ones its type already includes. */
    facilities: {
      type: [String],
      default: [],
    },
    /** Soft delete: keeps historical reservations pointing at a real room. */
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

// Room numbers are unique across the hotel, including deactivated rooms: 205
// must keep meaning one room for the reservations that reference it.
roomSchema.index({ roomNumber: 1 }, { unique: true });

// Serves the common "available rooms of this type" lookup.
// Serves the common "rooms of this type that can be sold" lookup, and the
// housekeeping board, which reads by housekeeping state across the hotel.
roomSchema.index({ isActive: 1, occupancy: 1, housekeeping: 1, roomType: 1 });
roomSchema.index({ housekeeping: 1, floor: 1 });

// Mongoose 9 drives middleware by the returned promise; hooks take no `next`.
roomSchema.pre("save", function normalise() {
  if (this.isModified("facilities")) {
    this.facilities = normaliseFacilities(this.facilities);
  }

  if (this.isModified("housekeeping")) {
    this.housekeepingChangedAt = new Date();
  }

  if (this.isModified("occupancy")) {
    this.occupancyChangedAt = new Date();
  }
});

/** True while a guest or a booking is attached to the room. */
roomSchema.methods.isInUse = function isInUse() {
  return IN_USE_OCCUPANCY.includes(this.occupancy);
};

/** True when a guest could be given this room right now: nobody in it, and
 * fit to sell. Both statuses have to agree. */
roomSchema.methods.isBookable = function isBookable() {
  return isSellable(this);
};

/**
 * True when the room is standing empty but is not fit to sell.
 *
 * The one number a manager should see every morning: rooms losing money
 * quietly because nobody has serviced them.
 */
roomSchema.methods.isDiscrepant = function roomIsDiscrepant() {
  return isDiscrepant(this);
};

/** Whether `roomType` was populated on this document. */
const isPopulatedType = (room) => Boolean(room.roomType && room.roomType.basePrice !== undefined);

/**
 * The price actually charged: the room's own price when it has one, otherwise
 * the type's base price. Requires a populated `roomType` to fall back.
 */
roomSchema.methods.effectivePrice = function effectivePrice() {
  if (this.price !== null && this.price !== undefined) return this.price;
  return isPopulatedType(this) ? this.roomType.basePrice : null;
};

/** Type facilities plus room extras, de-duplicated, type first. */
roomSchema.methods.effectiveFacilities = function effectiveFacilities() {
  const typeFacilities = isPopulatedType(this) ? this.roomType.facilities : [];
  return normaliseFacilities([...typeFacilities, ...this.facilities]);
};

roomSchema.methods.toSafeObject = function toSafeObject() {
  const populated = isPopulatedType(this);

  return {
    id: this._id.toString(),
    roomNumber: this.roomNumber,
    floor: this.floor,
    occupancy: this.occupancy,
    housekeeping: this.housekeeping,
    housekeepingNote: this.housekeepingNote,
    housekeepingChangedAt: this.housekeepingChangedAt,
    occupancyChangedAt: this.occupancyChangedAt,
    /** The room's own override, or null when it follows the type. */
    price: this.price,
    effectivePrice: this.effectivePrice(),
    facilities: this.facilities,
    effectiveFacilities: this.effectiveFacilities(),
    isActive: this.isActive,
    isBookable: this.isBookable(),
    isDiscrepant: this.isDiscrepant(),
    roomType: populated
      ? {
          id: this.roomType._id.toString(),
          name: this.roomType.name,
          basePrice: this.roomType.basePrice,
          maxOccupancy: this.roomType.maxOccupancy,
          isActive: this.roomType.isActive,
        }
      : { id: this.roomType?.toString() ?? null },
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

export const Room = mongoose.model("Room", roomSchema);
export default Room;
