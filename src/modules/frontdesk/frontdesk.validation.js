import { body } from "express-validator";
import {
  intQuery,
  mongoIdParam,
  noteBody,
} from "../../shared/validators/common.validators.js";
import { POLICY } from "../reservation/reservation.constants.js";
import { LIMITS } from "../room/room.constants.js";
import { OVERRIDE_REASON_MAX, OVERRIDE_REASON_MIN } from "./frontdesk.constants.js";

export const reservationIdValidation = mongoIdParam("id", "reservation");

const noteField = () => noteBody("note", POLICY.NOTE_MAX, "Note");

/**
 * An arrival, optionally with a manager waving an unpaid advance through.
 *
 * The reason is required as soon as an override is asked for, and it has a
 * minimum length on purpose: "ok" is not a reason, and this entry is going into
 * the audit log for somebody to read months later.
 */
export const checkInValidation = [
  ...reservationIdValidation,
  noteField(),
  body("override.reason")
    .optional()
    .trim()
    .isLength({ min: OVERRIDE_REASON_MIN, max: OVERRIDE_REASON_MAX })
    .withMessage(
      `An override reason must be between ${OVERRIDE_REASON_MIN} and ${OVERRIDE_REASON_MAX} characters`
    ),
];

export const checkOutValidation = [...reservationIdValidation, noteField()];

export const housekeepingBoardValidation = [
  intQuery("floor", { min: LIMITS.MIN_FLOOR, max: LIMITS.MAX_FLOOR, message: "Floor is out of range" }),
];
