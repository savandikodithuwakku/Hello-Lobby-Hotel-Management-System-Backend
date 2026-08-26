import mongoose from "mongoose";
import { normaliseFacilities } from "./roomType.model.js";
import {
  BOOKABLE_STATUSES,
  IN_USE_STATUSES,
  LIMITS,
  ROOM_STATUSES,
  ROOM_STATUS_VALUES,
} from "./room.constants.js";

/**
 * A physical room.
 *
 * Most of what a guest sees comes from the room's type; the room itself only
 * carries what is specific to it - its number, floor, live status, any price
 * that differs from the type's base price, and any extra facilities.
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
    status: {
      type: String,
      enum: ROOM_STATUS_VALUES,
      default: ROOM_STATUSES.AVAILABLE,
      index: true,
    },
    /** Why the room is in its current status ("deep clean", "AC repair"). */
    statusNote: {
      type: String,
      trim: true,
      maxlength: [LIMITS.NOTE_MAX, "Status note is too long"],
      default: "",
    },
    statusChangedAt: {
      type: Date,
      default: Date.now,
    },
    statusChangedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
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
roomSchema.index({ isActive: 1, status: 1, roomType: 1 });

// Mongoose 9 drives middleware by the returned promise; hooks take no `next`.
roomSchema.pre("save", function normalise() {
  if (this.isModified("facilities")) {
    this.facilities = normaliseFacilities(this.facilities);
  }

  if (this.isModified("status")) {
    this.statusChangedAt = new Date();
  }
});

/** True while a guest or a booking is attached to the room. */
roomSchema.methods.isInUse = function isInUse() {
  return IN_USE_STATUSES.includes(this.status);
};

/** True when the room can take a new booking right now. */
roomSchema.methods.isBookable = function isBookable() {
  return this.isActive && BOOKABLE_STATUSES.includes(this.status);
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
    status: this.status,
    statusNote: this.statusNote,
    statusChangedAt: this.statusChangedAt,
    /** The room's own override, or null when it follows the type. */
    price: this.price,
    effectivePrice: this.effectivePrice(),
    facilities: this.facilities,
    effectiveFacilities: this.effectiveFacilities(),
    isActive: this.isActive,
    isBookable: this.isBookable(),
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
