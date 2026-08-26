import { param, query } from "express-validator";
import {
  booleanQuery,
  intQuery,
  mongoIdParam,
  mongoIdQuery,
  paginationRules,
  searchRule,
  sortRule,
} from "../../shared/validators/common.validators.js";
import {
  AUDIT_ACTION_VALUES,
  AUDIT_ENTITY_VALUES,
  AUDIT_OUTCOME_VALUES,
  AUDIT_SORT_OPTIONS,
} from "./audit.constants.js";

export const auditEntryIdValidation = mongoIdParam("id", "audit entry");

const dateRangeRules = () => [
  query("from").optional().isISO8601().withMessage("from must be a valid date").toDate(),
  query("to").optional().isISO8601().withMessage("to must be a valid date").toDate(),
];

export const listAuditLogValidation = [
  ...paginationRules(),
  searchRule(120),
  query("action").optional().isIn(AUDIT_ACTION_VALUES).withMessage("Unknown action"),
  query("entityType").optional().isIn(AUDIT_ENTITY_VALUES).withMessage("Unknown record type"),
  mongoIdQuery("entityId", "Invalid record filter"),
  mongoIdQuery("actor", "Invalid user filter"),
  query("outcome").optional().isIn(AUDIT_OUTCOME_VALUES).withMessage("Unknown outcome"),
  // "Only the entries a security review cares about" - see SECURITY_ACTIONS.
  booleanQuery("security"),
  ...dateRangeRules(),
  sortRule(AUDIT_SORT_OPTIONS),
];

/**
 * The trail for one record, e.g. everything that has happened to a booking.
 * Addressed by type and id so any module's screen can link to it without the
 * audit module needing a route per module.
 */
export const entityTrailValidation = [
  param("entityType").isIn(AUDIT_ENTITY_VALUES).withMessage("Unknown record type"),
  ...mongoIdParam("entityId", "record"),
  ...paginationRules(),
  sortRule(AUDIT_SORT_OPTIONS),
];

export const auditStatisticsValidation = [
  intQuery("days", { min: 1, max: 90, message: "days must be between 1 and 90" }),
];
