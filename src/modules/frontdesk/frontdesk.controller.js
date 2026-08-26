import { sendOk } from "../../shared/utils/ApiResponse.js";
import asyncHandler from "../../shared/utils/asyncHandler.js";
import * as frontdeskService from "./frontdesk.service.js";
import { FRONTDESK_MESSAGES } from "./frontdesk.constants.js";

export const getBoard = asyncHandler(async (req, res) => {
  const board = await frontdeskService.getBoard(req.user);
  sendOk(res, FRONTDESK_MESSAGES.BOARD_FETCHED, board);
});

/** What would happen if the desk pressed check in. Changes nothing. */
export const previewCheckIn = asyncHandler(async (req, res) => {
  const result = await frontdeskService.previewCheckIn(req.params.id, req.user);

  sendOk(
    res,
    result.ready ? FRONTDESK_MESSAGES.READY : "This booking cannot be checked in yet",
    result
  );
});

export const checkIn = asyncHandler(async (req, res) => {
  const result = await frontdeskService.checkIn(req.user, req.params.id, req.body);

  sendOk(
    res,
    // Say plainly when a guest was let in on a manager's authority, so it is
    // never something that only shows up later in the audit log.
    result.overridden.length > 0
      ? "Guest checked in. The unpaid advance was overridden and recorded."
      : FRONTDESK_MESSAGES.CHECKED_IN,
    result
  );
});

/** The final bill, and whether anything is stopping the guest leaving. */
export const previewCheckOut = asyncHandler(async (req, res) => {
  const result = await frontdeskService.previewCheckOut(req.params.id, req.user);

  sendOk(
    res,
    result.ready ? "This booking is ready to check out" : "There is still a balance to settle",
    result
  );
});

export const checkOut = asyncHandler(async (req, res) => {
  const result = await frontdeskService.checkOut(req.user, req.params.id, req.body);
  sendOk(res, FRONTDESK_MESSAGES.CHECKED_OUT, result);
});

export const getHousekeepingBoard = asyncHandler(async (req, res) => {
  const board = await frontdeskService.getHousekeepingBoard(req.validatedQuery);
  sendOk(res, FRONTDESK_MESSAGES.HOUSEKEEPING_FETCHED, board);
});
