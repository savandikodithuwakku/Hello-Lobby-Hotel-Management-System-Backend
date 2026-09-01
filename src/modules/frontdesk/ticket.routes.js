import { Router } from "express";
import { authenticate } from "../auth/auth.middleware.js";
import { requirePermission } from "../auth/rbac/rbac.middleware.js";
import { PERMISSIONS } from "../auth/rbac/index.js";
import { validateRequest } from "../../shared/middleware/validate.middleware.js";
import * as ticketController from "./ticket.controller.js";
import {
  assignTicketValidation,
  changeStatusValidation,
  commentValidation,
  createTicketValidation,
  listTicketsValidation,
  roomBlockValidation,
  ticketIdValidation,
  updateTicketValidation,
} from "./ticket.validation.js";

/**
 * Guest service tickets.
 *
 * Reading is permission-scoped rather than route-scoped, as everywhere else: a
 * guest holding only `frontdesk:ticket_create` uses the same endpoints and sees
 * the tickets they raised, narrowed by the service.
 */
const router = Router();

const READ_TICKETS = [PERMISSIONS.FRONTDESK_TICKET_MANAGE, PERMISSIONS.FRONTDESK_TICKET_CREATE];

router.use(authenticate);

/** Declared before `/:id` so these are not read as ticket ids. */
router.get(
  "/statistics",
  requirePermission(PERMISSIONS.FRONTDESK_TICKET_MANAGE),
  ticketController.getTicketStatistics
);

router.get("/options", requirePermission(...READ_TICKETS), ticketController.getTicketOptions);

/** The assignee picker. Staff only - a guest has nobody to hand a ticket to. */
router.get(
  "/assignees",
  requirePermission(PERMISSIONS.FRONTDESK_TICKET_MANAGE),
  ticketController.getAssignableStaff
);

router.get(
  "/",
  requirePermission(...READ_TICKETS),
  listTicketsValidation,
  validateRequest,
  ticketController.listTickets
);

/** A guest may report a problem with their own stay; staff for anybody. */
router.post(
  "/",
  requirePermission(...READ_TICKETS),
  createTicketValidation,
  validateRequest,
  ticketController.createTicket
);

router.get(
  "/:id",
  requirePermission(...READ_TICKETS),
  ticketIdValidation,
  validateRequest,
  ticketController.getTicket
);

/** Adding a note is the one write a guest performs on their own ticket. */
router.post(
  "/:id/comments",
  requirePermission(...READ_TICKETS),
  commentValidation,
  validateRequest,
  ticketController.commentOnTicket
);

/* -------------------------------------------------------------------------- */
/* Staff only                                                                 */
/* -------------------------------------------------------------------------- */

router.patch(
  "/:id",
  requirePermission(PERMISSIONS.FRONTDESK_TICKET_MANAGE),
  updateTicketValidation,
  validateRequest,
  ticketController.updateTicket
);

router.patch(
  "/:id/assignee",
  requirePermission(PERMISSIONS.FRONTDESK_TICKET_MANAGE),
  assignTicketValidation,
  validateRequest,
  ticketController.assignTicket
);

router.post(
  "/:id/status",
  requirePermission(PERMISSIONS.FRONTDESK_TICKET_MANAGE),
  changeStatusValidation,
  validateRequest,
  ticketController.changeTicketStatus
);

/**
 * Takes the room out of service because of this ticket, or gives it back.
 *
 * Needs the housekeeping permission as well as the ticket one: this genuinely
 * changes what the hotel can sell tonight, so it is not something everyone who
 * can work a ticket should be able to do on their own.
 */
router.post(
  "/:id/room-block",
  requirePermission(PERMISSIONS.FRONTDESK_TICKET_MANAGE),
  requirePermission(PERMISSIONS.ROOM_MANAGE_STATUS),
  roomBlockValidation,
  validateRequest,
  ticketController.setRoomBlock
);

export default router;
