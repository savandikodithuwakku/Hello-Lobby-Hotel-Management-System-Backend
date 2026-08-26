import { Router } from "express";
import { authenticate } from "../auth/auth.middleware.js";
import { requirePermission } from "../auth/rbac/rbac.middleware.js";
import { PERMISSIONS } from "../auth/rbac/permissions.js";
import { validateRequest } from "../../shared/middleware/validate.middleware.js";
import * as auditController from "./audit.controller.js";
import {
  auditEntryIdValidation,
  auditStatisticsValidation,
  entityTrailValidation,
  listAuditLogValidation,
} from "./audit.validation.js";

/**
 * The audit log.
 *
 * Read-only by design: there is no endpoint that writes, edits or deletes an
 * entry, because entries are written by the services as things happen. A log
 * anyone can post to, or tidy up afterwards, is not evidence of anything.
 *
 * Every route needs `audit_log:view`, which only administrators hold. The log
 * shows who did what from which address across the whole system, so it is more
 * sensitive than most of the records it describes.
 */
const router = Router();

router.use(authenticate);
router.use(requirePermission(PERMISSIONS.AUDIT_LOG_VIEW));

/** Declared before `/:id` so "statistics" is not read as an entry id. */
router.get(
  "/statistics",
  auditStatisticsValidation,
  validateRequest,
  auditController.getAuditStatistics
);

/** The action and record-type lists the filters are built from. */
router.get("/options", auditController.getAuditOptions);

/**
 * The trail for one record. Any module's detail screen can link straight here
 * without the audit module needing to know that module exists.
 */
router.get(
  "/records/:entityType/:entityId",
  entityTrailValidation,
  validateRequest,
  auditController.getEntityTrail
);

router.get("/", listAuditLogValidation, validateRequest, auditController.listAuditLog);

router.get("/:id", auditEntryIdValidation, validateRequest, auditController.getAuditEntry);

export default router;
