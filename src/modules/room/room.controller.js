import { sendCreated, sendOk } from "../../shared/utils/ApiResponse.js";
import asyncHandler from "../../shared/utils/asyncHandler.js";
import * as roomService from "./room.service.js";

export const listRooms = asyncHandler(async (req, res) => {
  const result = await roomService.listRooms(req.validatedQuery);
  sendOk(res, "Rooms fetched successfully", result);
});

export const listAvailableRooms = asyncHandler(async (req, res) => {
  const result = await roomService.listAvailableRooms(req.validatedQuery);
  sendOk(res, "Available rooms fetched successfully", result);
});

export const getRoomStatistics = asyncHandler(async (req, res) => {
  const statistics = await roomService.getRoomStatistics();
  sendOk(res, "Room statistics fetched successfully", statistics);
});

export const getRoom = asyncHandler(async (req, res) => {
  const room = await roomService.getRoomById(req.params.id);
  sendOk(res, "Room fetched successfully", { room });
});

export const createRoom = asyncHandler(async (req, res) => {
  const room = await roomService.createRoom(req.user, req.body);
  sendCreated(res, "Room created successfully", { room });
});

export const updateRoom = asyncHandler(async (req, res) => {
  const room = await roomService.updateRoom(req.user, req.params.id, req.body);
  sendOk(res, "Room updated successfully", { room });
});

export const changeHousekeepingStatus = asyncHandler(async (req, res) => {
  const room = await roomService.changeHousekeepingStatus(req.user, req.params.id, req.body);
  sendOk(res, `Room ${room.roomNumber} is now ${room.housekeeping}`, { room });
});

export const deactivateRoom = asyncHandler(async (req, res) => {
  const room = await roomService.deactivateRoom(req.user, req.params.id, req.body);
  sendOk(res, `Room ${room.roomNumber} removed from inventory. Its history is kept.`, { room });
});

export const restoreRoom = asyncHandler(async (req, res) => {
  const room = await roomService.restoreRoom(req.user, req.params.id);
  sendOk(res, `Room ${room.roomNumber} is back in the inventory, ready for cleaning`, { room });
});
