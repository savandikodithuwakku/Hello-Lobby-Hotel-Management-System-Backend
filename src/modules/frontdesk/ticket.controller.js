import { sendCreated, sendOk } from "../../shared/utils/ApiResponse.js";
import asyncHandler from "../../shared/utils/asyncHandler.js";
import * as ticketService from "./ticket.service.js";
import {
  TICKET_CATEGORY_VALUES,
  TICKET_MESSAGES,
  TICKET_PRIORITY_VALUES,
  TICKET_STATUS_VALUES,
} from "./ticket.constants.js";

export const listTickets = asyncHandler(async (req, res) => {
  // The service narrows the list to the caller's own when they may only see those.
  const result = await ticketService.listTickets(req.validatedQuery, req.user);
  sendOk(res, TICKET_MESSAGES.FETCHED, result);
});

export const getTicketStatistics = asyncHandler(async (req, res) => {
  const statistics = await ticketService.getTicketStatistics();
  sendOk(res, "Ticket statistics fetched", statistics);
});

/**
 * The vocabulary the filters are built from, read off the server's own lists so
 * a new category never has to be typed into the UI a second time.
 */
export const getTicketOptions = asyncHandler(async (req, res) => {
  sendOk(res, "Ticket options fetched", {
    categories: TICKET_CATEGORY_VALUES,
    priorities: TICKET_PRIORITY_VALUES,
    statuses: TICKET_STATUS_VALUES,
  });
});

export const getTicket = asyncHandler(async (req, res) => {
  const ticket = await ticketService.getTicketById(req.params.id, req.user);
  sendOk(res, "Ticket fetched successfully", { ticket });
});

export const createTicket = asyncHandler(async (req, res) => {
  const ticket = await ticketService.createTicket(req.user, req.body);
  sendCreated(res, `${TICKET_MESSAGES.CREATED} as ${ticket.reference}`, { ticket });
});

export const updateTicket = asyncHandler(async (req, res) => {
  const ticket = await ticketService.updateTicket(req.user, req.params.id, req.body);
  sendOk(res, TICKET_MESSAGES.UPDATED, { ticket });
});

export const assignTicket = asyncHandler(async (req, res) => {
  const ticket = await ticketService.assignTicket(req.user, req.params.id, req.body);
  sendOk(res, TICKET_MESSAGES.ASSIGNED, { ticket });
});

export const commentOnTicket = asyncHandler(async (req, res) => {
  const ticket = await ticketService.commentOnTicket(req.user, req.params.id, req.body);
  sendOk(res, "Note added", { ticket });
});

export const changeTicketStatus = asyncHandler(async (req, res) => {
  const ticket = await ticketService.changeTicketStatus(req.user, req.params.id, req.body);
  sendOk(res, TICKET_MESSAGES.STATUS_CHANGED, { ticket });
});

export const setRoomBlock = asyncHandler(async (req, res) => {
  const ticket = await ticketService.setRoomBlock(req.user, req.params.id, req.body);

  sendOk(
    res,
    ticket.blocksRoom
      ? `Room ${ticket.room.roomNumber} is out of order until this is resolved`
      : `Room ${ticket.room.roomNumber} handed back to housekeeping`,
    { ticket }
  );
});
