import ApiResponse from "../../shared/utils/ApiResponse.js";
import asyncHandler from "../../shared/utils/asyncHandler.js";
import * as roomTypeService from "./roomType.service.js";

export const listRoomTypes = asyncHandler(async (req, res) => {
  // The viewer decides how much of a room type comes back: staff see the
  // inventory side of it, guests only what is for sale.
  const result = await roomTypeService.listRoomTypes(req.validatedQuery, req.user);
  res.status(200).json(new ApiResponse(200, "Room types fetched successfully", result));
});

export const getRoomType = asyncHandler(async (req, res) => {
  const roomType = await roomTypeService.getRoomTypeById(req.params.id, req.user);
  res.status(200).json(new ApiResponse(200, "Room type fetched successfully", { roomType }));
});

export const createRoomType = asyncHandler(async (req, res) => {
  const roomType = await roomTypeService.createRoomType(req.user, req.body);
  res.status(201).json(new ApiResponse(201, "Room type created successfully", { roomType }));
});

export const updateRoomType = asyncHandler(async (req, res) => {
  const roomType = await roomTypeService.updateRoomType(req.user, req.params.id, req.body);
  res.status(200).json(new ApiResponse(200, "Room type updated successfully", { roomType }));
});

export const deactivateRoomType = asyncHandler(async (req, res) => {
  const roomType = await roomTypeService.deactivateRoomType(req.user, req.params.id);
  res
    .status(200)
    .json(new ApiResponse(200, "Room type deactivated. Its rooms and history are kept.", { roomType }));
});

export const restoreRoomType = asyncHandler(async (req, res) => {
  const roomType = await roomTypeService.restoreRoomType(req.user, req.params.id);
  res.status(200).json(new ApiResponse(200, "Room type restored successfully", { roomType }));
});
