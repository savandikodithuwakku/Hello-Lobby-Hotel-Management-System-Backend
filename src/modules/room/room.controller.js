import ApiResponse from "../../shared/utils/ApiResponse.js";
import asyncHandler from "../../shared/utils/asyncHandler.js";
import * as roomService from "./room.service.js";

export const listRooms = asyncHandler(async (req, res) => {
  const result = await roomService.listRooms(req.validatedQuery);
  res.status(200).json(new ApiResponse(200, "Rooms fetched successfully", result));
});

export const listAvailableRooms = asyncHandler(async (req, res) => {
  const result = await roomService.listAvailableRooms(req.validatedQuery);
  res.status(200).json(new ApiResponse(200, "Available rooms fetched successfully", result));
});

export const getRoomStatistics = asyncHandler(async (req, res) => {
  const statistics = await roomService.getRoomStatistics();
  res.status(200).json(new ApiResponse(200, "Room statistics fetched successfully", statistics));
});

export const getRoom = asyncHandler(async (req, res) => {
  const room = await roomService.getRoomById(req.params.id);
  res.status(200).json(new ApiResponse(200, "Room fetched successfully", { room }));
});

export const createRoom = asyncHandler(async (req, res) => {
  const room = await roomService.createRoom(req.user, req.body);
  res.status(201).json(new ApiResponse(201, "Room created successfully", { room }));
});

export const updateRoom = asyncHandler(async (req, res) => {
  const room = await roomService.updateRoom(req.user, req.params.id, req.body);
  res.status(200).json(new ApiResponse(200, "Room updated successfully", { room }));
});

export const changeRoomStatus = asyncHandler(async (req, res) => {
  const room = await roomService.changeRoomStatus(req.user, req.params.id, req.body);
  res.status(200).json(new ApiResponse(200, `Room ${room.roomNumber} is now ${room.status}`, { room }));
});

export const deactivateRoom = asyncHandler(async (req, res) => {
  const room = await roomService.deactivateRoom(req.user, req.params.id, req.body);
  res
    .status(200)
    .json(
      new ApiResponse(200, `Room ${room.roomNumber} removed from inventory. Its history is kept.`, {
        room,
      })
    );
});

export const restoreRoom = asyncHandler(async (req, res) => {
  const room = await roomService.restoreRoom(req.user, req.params.id);
  res
    .status(200)
    .json(
      new ApiResponse(200, `Room ${room.roomNumber} is back in the inventory, ready for cleaning`, {
        room,
      })
    );
});
