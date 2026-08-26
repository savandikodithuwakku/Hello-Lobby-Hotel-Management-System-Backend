import { body, query } from "express-validator";
import {
  booleanQuery,
  mongoIdBody,
  mongoIdParam,
  mongoIdQuery,
  noteBody,
  paginationRules,
  searchRule,
  sortRule,
  stripFields,
} from "../../shared/validators/common.validators.js";
import {
  POLICY,
  TICKET_CATEGORY_VALUES,
  TICKET_PRIORITY_VALUES,
  TICKET_SORT_OPTIONS,
  TICKET_STATUS_VALUES,
} from "./ticket.constants.js";

export const ticketIdValidation = mongoIdParam("id", "ticket");

const noteField = (field = "note", label = "Note") => noteBody(field, POLICY.NOTE_MAX, label);

/** Fields the server derives itself and must never accept from a client. */
const SERVER_OWNED_FIELDS = ["status", "reference", "respondBy", "updates", "reportedBy"];

export const listTicketsValidation = [
  ...paginationRules(),
  searchRule(120),
  query("status").optional().isIn(TICKET_STATUS_VALUES).withMessage("Unknown status"),
  query("category").optional().isIn(TICKET_CATEGORY_VALUES).withMessage("Unknown category"),
  query("priority").optional().isIn(TICKET_PRIORITY_VALUES).withMessage("Unknown priority"),
  mongoIdQuery("room", "Invalid room filter"),
  mongoIdQuery("guest", "Invalid guest filter"),
  mongoIdQuery("assignedTo", "Invalid assignee filter"),
  /** Everything still needing somebody to do something. */
  booleanQuery("active"),
  /** Nobody has picked it up and the response target has passed. */
  booleanQuery("overdue"),
  booleanQuery("unassigned"),
  sortRule(TICKET_SORT_OPTIONS),
];

/**
 * Raising a ticket.
 *
 * The guest, room and priority are accepted but the service decides whether the
 * caller may set them: a guest raising a ticket about their own stay gets all
 * three worked out from the booking they named.
 */
export const createTicketValidation = [
  body("subject")
    .trim()
    .notEmpty()
    .withMessage("Give the ticket a short subject")
    .isLength({ max: POLICY.SUBJECT_MAX })
    .withMessage("The subject is too long"),
  body("description")
    .trim()
    .notEmpty()
    .withMessage("Say what the problem is")
    .isLength({ max: POLICY.DESCRIPTION_MAX })
    .withMessage("The description is too long"),
  body("category").isIn(TICKET_CATEGORY_VALUES).withMessage("Choose a category"),
  body("priority").optional().isIn(TICKET_PRIORITY_VALUES).withMessage("Unknown priority"),
  mongoIdBody("reservation", "Invalid reservation", { optional: true }),
  mongoIdBody("room", "Invalid room", { optional: true }),
  mongoIdBody("guest", "Invalid guest", { optional: true }),
  body("blocksRoom").optional().isBoolean().withMessage("blocksRoom must be true or false").toBoolean(),
  stripFields(SERVER_OWNED_FIELDS),
];

export const updateTicketValidation = [
  ...ticketIdValidation,
  body("subject")
    .optional()
    .trim()
    .notEmpty()
    .withMessage("The subject cannot be empty")
    .isLength({ max: POLICY.SUBJECT_MAX })
    .withMessage("The subject is too long"),
  body("description")
    .optional()
    .trim()
    .notEmpty()
    .withMessage("The description cannot be empty")
    .isLength({ max: POLICY.DESCRIPTION_MAX })
    .withMessage("The description is too long"),
  body("category").optional().isIn(TICKET_CATEGORY_VALUES).withMessage("Unknown category"),
  body("priority").optional().isIn(TICKET_PRIORITY_VALUES).withMessage("Unknown priority"),
  // Who and what it is about is fixed once the ticket exists.
  stripFields([...SERVER_OWNED_FIELDS, "guest", "room", "reservation", "blocksRoom"]),
];

export const assignTicketValidation = [
  ...ticketIdValidation,
  // `null` is meaningful: it takes the ticket back off whoever had it.
  body("assignedTo")
    .optional({ values: "null" })
    .isMongoId()
    .withMessage("Invalid member of staff"),
];

export const commentValidation = [
  ...ticketIdValidation,
  body("note")
    .trim()
    .notEmpty()
    .withMessage("Write something")
    .isLength({ max: POLICY.NOTE_MAX })
    .withMessage("The note is too long"),
];

export const changeStatusValidation = [
  ...ticketIdValidation,
  body("status").isIn(TICKET_STATUS_VALUES).withMessage("Unknown status"),
  body("resolution")
    .optional()
    .trim()
    .isLength({ max: POLICY.RESOLUTION_MAX })
    .withMessage("The resolution is too long"),
  noteField(),
];

export const roomBlockValidation = [
  ...ticketIdValidation,
  body("blocksRoom").isBoolean().withMessage("blocksRoom must be true or false").toBoolean(),
];
