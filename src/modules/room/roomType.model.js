import mongoose from "mongoose";
import { LIMITS } from "./room.constants.js";

/**
 * Normalises a facility list: trims, drops blanks, removes duplicates
 * case-insensitively and keeps the first spelling the operator used.
 */
export const normaliseFacilities = (facilities = []) => {
  const seen = new Set();

  return facilities
    .map((facility) => String(facility).trim())
    .filter((facility) => {
      if (!facility) return false;
      const key = facility.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, LIMITS.MAX_FACILITIES);
};

const imageSchema = new mongoose.Schema(
  {
    url: {
      type: String,
      required: [true, "Image URL is required"],
      trim: true,
    },
    alt: {
      type: String,
      trim: true,
      maxlength: [LIMITS.IMAGE_ALT_MAX, "Image description is too long"],
      default: "",
    },
    isPrimary: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false }
);

/**
 * A room type is the catalogue entry (Standard, Deluxe, Suite, ...). It carries
 * the defaults every room of that type inherits: the base price, how many
 * guests fit, the facilities included and the photos shown to a guest.
 *
 * Types are never hard-deleted. Rooms and, later, reservations reference them,
 * so a withdrawn type is deactivated and its history stays readable.
 */
const roomTypeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Room type name is required"],
      trim: true,
      minlength: [LIMITS.NAME_MIN, "Name must be at least 2 characters"],
      maxlength: [LIMITS.NAME_MAX, "Name must not exceed 60 characters"],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [LIMITS.DESCRIPTION_MAX, "Description is too long"],
      default: "",
    },
    basePrice: {
      type: Number,
      required: [true, "Base price is required"],
      min: [0, "Base price cannot be negative"],
      max: [LIMITS.MAX_PRICE, "Base price is unrealistically high"],
    },
    maxOccupancy: {
      type: Number,
      required: [true, "Maximum occupancy is required"],
      min: [1, "Maximum occupancy must be at least 1"],
      max: [LIMITS.MAX_OCCUPANCY, "Maximum occupancy is unrealistically high"],
    },
    facilities: {
      type: [String],
      default: [],
    },
    images: {
      type: [imageSchema],
      default: [],
    },
    /** Soft delete. A withdrawn type keeps its rooms and history intact. */
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

/**
 * Case-insensitive uniqueness: "Deluxe" and "deluxe" are the same type, and an
 * operator should be told so rather than ending up with two catalogue entries.
 */
roomTypeSchema.index(
  { name: 1 },
  { unique: true, collation: { locale: "en", strength: 2 } }
);

// Mongoose 9 drives middleware by the returned promise; hooks take no `next`.
roomTypeSchema.pre("save", function normalise() {
  if (this.isModified("facilities")) {
    this.facilities = normaliseFacilities(this.facilities);
  }

  if (this.isModified("images") && this.images.length > 0) {
    // Exactly one primary image: the first one flagged, or the first uploaded.
    const primaryIndex = Math.max(
      this.images.findIndex((image) => image.isPrimary),
      0
    );
    this.images.forEach((image, index) => {
      image.isPrimary = index === primaryIndex;
    });
  }
});

roomTypeSchema.methods.primaryImage = function primaryImage() {
  return this.images.find((image) => image.isPrimary) || this.images[0] || null;
};

/**
 * What a guest is allowed to see: the sales information, and nothing about the
 * hotel's inventory. No room counts, no activation flag, no audit timestamps.
 */
roomTypeSchema.methods.toPublicObject = function toPublicObject() {
  return {
    id: this._id.toString(),
    name: this.name,
    description: this.description,
    basePrice: this.basePrice,
    maxOccupancy: this.maxOccupancy,
    facilities: this.facilities,
    images: this.images.map((image) => ({
      url: image.url,
      alt: image.alt,
      isPrimary: image.isPrimary,
    })),
    primaryImage: this.primaryImage()?.url || null,
  };
};

roomTypeSchema.methods.toSafeObject = function toSafeObject(extra = {}) {
  return {
    id: this._id.toString(),
    name: this.name,
    description: this.description,
    basePrice: this.basePrice,
    maxOccupancy: this.maxOccupancy,
    facilities: this.facilities,
    images: this.images.map((image) => ({
      url: image.url,
      alt: image.alt,
      isPrimary: image.isPrimary,
    })),
    primaryImage: this.primaryImage()?.url || null,
    isActive: this.isActive,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
    ...extra,
  };
};

export const RoomType = mongoose.model("RoomType", roomTypeSchema);
export default RoomType;
