import ApiError from "../../shared/utils/ApiError.js";
import { AUDIT_ACTIONS, AUDIT_ENTITIES } from "../audit/audit.constants.js";
import { recordAudit, recordUpdate } from "../audit/audit.service.js";
import { paginateQuery } from "../../shared/utils/pagination.util.js";
import { containsInsensitive, equalsInsensitive } from "../../shared/utils/text.util.js";
import { PERMISSIONS } from "../auth/rbac/index.js";
import RoomType from "./roomType.model.js";
import Room from "./room.model.js";
import { DEFAULT_ROOM_TYPE_SORT } from "./room.constants.js";

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
const byName = (name) => ({ name: equalsInsensitive(name) });

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
    page,
    limit,
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
    const pattern = containsInsensitive(search);
    filter.$or = [{ name: pattern }, { description: pattern }];
  }

  if (minPrice !== undefined || maxPrice !== undefined) {
    filter.basePrice = {};
    if (minPrice !== undefined) filter.basePrice.$gte = minPrice;
    if (maxPrice !== undefined) filter.basePrice.$lte = maxPrice;
  }

  // "Fits 4 guests" means a type whose maximum is at least 4.
  if (occupancy !== undefined) filter.maxOccupancy = { $gte: occupancy };

  const { documents: roomTypes, pagination } = await paginateQuery(RoomType, filter, {
    page,
    limit,
    sort,
  });

  const roomCounts = staffView
    ? await countRoomsByType(roomTypes.map((type) => type._id))
    : new Map();

  return {
    roomTypes: roomTypes.map((type) =>
      staffView
        ? type.toSafeObject({ roomCount: roomCounts.get(type._id.toString()) || 0 })
        : type.toPublicObject()
    ),
    pagination,
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


/* -------------------------------------------------------------------------- */
/* Audit                                                                      */
/* -------------------------------------------------------------------------- */

const auditEntity = (roomType) => ({
  type: AUDIT_ENTITIES.ROOM_TYPE,
  id: roomType._id,
  label: roomType.name,
});

/** The fields worth recording a change to. Base price is the important one -
 * it is what every future booking of this type will be quoted at. */
const AUDITED_FIELDS = ["name", "description", "basePrice", "maxOccupancy", "facilities"];

const auditSnapshot = (roomType) =>
  Object.fromEntries(
    AUDITED_FIELDS.map((field) => [
      field,
      Array.isArray(roomType[field]) ? [...roomType[field]] : roomType[field],
    ])
  );

export const createRoomType = async (actor, payload) => {
  if (await RoomType.exists(byName(payload.name))) {
    throw new ApiError(409, `A room type named "${payload.name.trim()}" already exists`);
  }

  const roomType = await RoomType.create({
    ...payload,
    createdBy: actor._id,
    updatedBy: actor._id,
  });

  await recordAudit({
    action: AUDIT_ACTIONS.ROOM_TYPE_CREATED,
    entity: auditEntity(roomType),
    actor,
    description: `Added the room type "${roomType.name}" at ${roomType.basePrice}`,
  });

  return roomType.toSafeObject({ roomCount: 0 });
};

export const updateRoomType = async (actor, id, payload) => {
  const roomType = await findTypeOrFail(id);

  const before = auditSnapshot(roomType);

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

  await recordUpdate({
    action: AUDIT_ACTIONS.ROOM_TYPE_UPDATED,
    entity: auditEntity(roomType),
    actor,
    before,
    after: auditSnapshot(roomType),
    description: `Edited the room type "${roomType.name}"`,
  });

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

  await recordAudit({
    action: AUDIT_ACTIONS.ROOM_TYPE_DEACTIVATED,
    entity: auditEntity(roomType),
    actor,
    description: `Withdrew the room type "${roomType.name}"`,
  });

  return getRoomTypeById(roomType._id, actor);
};

export const restoreRoomType = async (actor, id) => {
  const roomType = await findTypeOrFail(id);

  roomType.isActive = true;
  roomType.updatedBy = actor._id;
  await roomType.save();

  await recordAudit({
    action: AUDIT_ACTIONS.ROOM_TYPE_RESTORED,
    entity: auditEntity(roomType),
    actor,
    description: `Restored the room type "${roomType.name}"`,
  });

  return getRoomTypeById(roomType._id, actor);
};
