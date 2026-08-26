import ApiResponse from "../../shared/utils/ApiResponse.js";
import asyncHandler from "../../shared/utils/asyncHandler.js";
import * as userService from "./user.service.js";

export const listUsers = asyncHandler(async (req, res) => {
  const result = await userService.listUsers(req.validatedQuery);
  res.status(200).json(new ApiResponse(200, "Users fetched successfully", result));
});

export const getUser = asyncHandler(async (req, res) => {
  const user = await userService.getUserById(req.params.id);
  res.status(200).json(new ApiResponse(200, "User fetched successfully", { user }));
});

export const createUser = asyncHandler(async (req, res) => {
  const user = await userService.createUser(req.user, req.body);
  res.status(201).json(new ApiResponse(201, "User created and invitation email sent", { user }));
});

export const updateUser = asyncHandler(async (req, res) => {
  const user = await userService.updateUser(req.user, req.params.id, req.body);
  res.status(200).json(new ApiResponse(200, "User updated successfully", { user }));
});

export const changeUserRole = asyncHandler(async (req, res) => {
  const user = await userService.changeUserRole(req.user, req.params.id, req.body);
  res.status(200).json(new ApiResponse(200, "User role updated successfully", { user }));
});

export const changeUserStatus = asyncHandler(async (req, res) => {
  const user = await userService.changeUserStatus(req.user, req.params.id, req.body);
  res.status(200).json(new ApiResponse(200, "User status updated successfully", { user }));
});

export const changeUserPermissions = asyncHandler(async (req, res) => {
  const user = await userService.changeUserPermissions(req.user, req.params.id, req.body);
  res.status(200).json(new ApiResponse(200, "User permissions updated successfully", { user }));
});

export const deactivateUser = asyncHandler(async (req, res) => {
  const user = await userService.deactivateUser(req.user, req.params.id);
  res.status(200).json(new ApiResponse(200, "User deactivated successfully", { user }));
});

export const deleteUser = asyncHandler(async (req, res) => {
  const result = await userService.deleteUser(req.user, req.params.id, req.body);
  res.status(200).json(new ApiResponse(200, "User permanently deleted", result));
});

export const revokeUserSessions = asyncHandler(async (req, res) => {
  const result = await userService.revokeUserSessions(req.user, req.params.id);
  res.status(200).json(new ApiResponse(200, "All sessions for this user were revoked", result));
});
