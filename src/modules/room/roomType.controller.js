import { sendCreated, sendOk } from "../../shared/utils/ApiResponse.js";
import asyncHandler from "../../shared/utils/asyncHandler.js";
import * as roomTypeService from "./roomType.service.js";

export const listRoomTypes = asyncHandler(async (req, res) => {
  // The viewer decides how much of a room type comes back: staff see the
  // inventory side of it, guests only what is for sale.
  const result = await roomTypeService.listRoomTypes(req.validatedQuery, req.user);
  sendOk(res, "Room types fetched successfully", result);
});

export const getRoomType = asyncHandler(async (req, res) => {
  const roomType = await roomTypeService.getRoomTypeById(req.params.id, req.user);
  sendOk(res, "Room type fetched successfully", { roomType });
});

export const createRoomType = asyncHandler(async (req, res) => {
  const roomType = await roomTypeService.createRoomType(req.user, req.body);
  sendCreated(res, "Room type created successfully", { roomType });
});

export const updateRoomType = asyncHandler(async (req, res) => {
  const roomType = await roomTypeService.updateRoomType(req.user, req.params.id, req.body);
  sendOk(res, "Room type updated successfully", { roomType });
});

export const deactivateRoomType = asyncHandler(async (req, res) => {
  const roomType = await roomTypeService.deactivateRoomType(req.user, req.params.id);
  sendOk(res, "Room type deactivated. Its rooms and history are kept.", { roomType });
});

export const restoreRoomType = asyncHandler(async (req, res) => {
  const roomType = await roomTypeService.restoreRoomType(req.user, req.params.id);
  sendOk(res, "Room type restored successfully", { roomType });
});
