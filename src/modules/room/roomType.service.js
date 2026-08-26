import ApiError from "../../shared/utils/ApiError.js";
import { PERMISSIONS } from "../auth/rbac/permissions.js";
import RoomType from "./roomType.model.js";
import Room from "./room.model.js";
import {
  DEFAULT_PAGE_SIZE,
  DEFAULT_ROOM_TYPE_SORT,
  MAX_PAGE_SIZE,
} from "./room.constants.js";

/**
 * Whether the caller works here.
 *
 * `room:read` is the permission that opens the physical inventory, so it is
 * also the line between a guest browsing the catalogue and a member of staff
 * looking at it. A guest sees only what is being sold; anything about how many
 * rooms exist, or whether a type is still active, is inventory information.
 */
const canSeeInventory = (viewer) => Boolean(viewer?.hasPermission(PERMISSIONS.ROOM_READ));

/** Case-insensitive exact match, so "Deluxe" collides with "deluxe". */
const byName = (name) => ({ name: new RegExp(`^${escapeRegex(name.trim())}$`, "i") });

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const findTypeOrFail = async (id) => {
  const roomType = await RoomType.findById(id);

  if (!roomType) {
    throw new ApiError(404, "Room type not found");
  }

  return roomType;
};

/** Counts rooms per type in one query, so the list does not fan out per row. */
const countRoomsByType = async (typeIds) => {
  const rows = await Room.aggregate([
    { $match: { roomType: { $in: typeIds }, isActive: true } },
    { $group: { _id: "$roomType", count: { $sum: 1 } } },
  ]);

  return new Map(rows.map((row) => [row._id.toString(), row.count]));
};

export const listRoomTypes = async (
  {
    page = 1,
    limit = DEFAULT_PAGE_SIZE,
    search,
    isActive,
    minPrice,
    maxPrice,
    occupancy,
    sort = DEFAULT_ROOM_TYPE_SORT,
  },
  viewer = null
) => {
  const filter = {};
  const staffView = canSeeInventory(viewer);

  if (staffView) {
    // `isActive` arrives already coerced to a boolean, or undefined for "any".
    if (isActive !== undefined) filter.isActive = isActive;
  } else {
    // A withdrawn type is not for sale, so a guest never sees one - whatever
    // they put in the query string.
    filter.isActive = true;
  }

  if (search) {
    const pattern = new RegExp(escapeRegex(search), "i");
    filter.$or = [{ name: pattern }, { description: pattern }];
  }

  if (minPrice !== undefined || maxPrice !== undefined) {
    filter.basePrice = {};
    if (minPrice !== undefined) filter.basePrice.$gte = minPrice;
    if (maxPrice !== undefined) filter.basePrice.$lte = maxPrice;
  }

  // "Fits 4 guests" means a type whose maximum is at least 4.
  if (occupancy !== undefined) filter.maxOccupancy = { $gte: occupancy };

  const safeLimit = Math.min(Number(limit) || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const safePage = Math.max(Number(page) || 1, 1);

  const [roomTypes, total] = await Promise.all([
    RoomType.find(filter)
      .sort(sort)
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit),
    RoomType.countDocuments(filter),
  ]);

  const roomCounts = staffView
    ? await countRoomsByType(roomTypes.map((type) => type._id))
    : new Map();

  return {
    roomTypes: roomTypes.map((type) =>
      staffView
        ? type.toSafeObject({ roomCount: roomCounts.get(type._id.toString()) || 0 })
        : type.toPublicObject()
    ),
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.ceil(total / safeLimit) || 1,
    },
  };
};

export const getRoomTypeById = async (id, viewer = null) => {
  const roomType = await findTypeOrFail(id);

  if (!canSeeInventory(viewer)) {
    // Withdrawn types simply do not exist as far as a guest is concerned.
    if (!roomType.isActive) {
      throw new ApiError(404, "Room type not found");
    }

    return roomType.toPublicObject();
  }

  const [roomCount, activeRoomCount] = await Promise.all([
    Room.countDocuments({ roomType: roomType._id }),
    Room.countDocuments({ roomType: roomType._id, isActive: true }),
  ]);

  return roomType.toSafeObject({ roomCount, activeRoomCount });
};

export const createRoomType = async (actor, payload) => {
  if (await RoomType.exists(byName(payload.name))) {
    throw new ApiError(409, `A room type named "${payload.name.trim()}" already exists`);
  }

  const roomType = await RoomType.create({
    ...payload,
    createdBy: actor._id,
    updatedBy: actor._id,
  });

  return roomType.toSafeObject({ roomCount: 0 });
};

export const updateRoomType = async (actor, id, payload) => {
  const roomType = await findTypeOrFail(id);

  if (payload.name !== undefined) {
    const clash = await RoomType.findOne(byName(payload.name));
    if (clash && !clash._id.equals(roomType._id)) {
      throw new ApiError(409, `A room type named "${payload.name.trim()}" already exists`);
    }
  }

  // Only assign what the caller actually sent, so a partial patch never wipes
  // a field it did not mention.
  ["name", "description", "basePrice", "maxOccupancy", "facilities", "images"].forEach((field) => {
    if (payload[field] !== undefined) roomType[field] = payload[field];
  });

  roomType.updatedBy = actor._id;
  await roomType.save();

  return getRoomTypeById(roomType._id, actor);
};

/**
 * Soft delete. Refused while active rooms still use the type: the operator has
 * to move or deactivate those rooms first, which keeps the inventory honest
 * instead of leaving rooms pointing at a withdrawn catalogue entry.
 */
export const deactivateRoomType = async (actor, id) => {
  const roomType = await findTypeOrFail(id);

  if (!roomType.isActive) {
    return getRoomTypeById(roomType._id, actor);
  }

  const activeRooms = await Room.countDocuments({ roomType: roomType._id, isActive: true });

  if (activeRooms > 0) {
    throw new ApiError(
      409,
      `${activeRooms} active room(s) still use this type. Move or deactivate them first.`
    );
  }

  roomType.isActive = false;
  roomType.updatedBy = actor._id;
  await roomType.save();

  return getRoomTypeById(roomType._id, actor);
};

export const restoreRoomType = async (actor, id) => {
  const roomType = await findTypeOrFail(id);

  roomType.isActive = true;
  roomType.updatedBy = actor._id;
  await roomType.save();

  return getRoomTypeById(roomType._id, actor);
};
