import { sendOk } from "../../shared/utils/ApiResponse.js";
import asyncHandler from "../../shared/utils/asyncHandler.js";
import * as auditService from "./audit.service.js";
import { AUDIT_ACTION_VALUES, AUDIT_ENTITIES, AUDIT_MESSAGES } from "./audit.constants.js";

export const listAuditLog = asyncHandler(async (req, res) => {
  const result = await auditService.listAuditLog(req.validatedQuery);
  sendOk(res, AUDIT_MESSAGES.FETCHED, result);
});

/** Everything that has ever happened to one record. */
export const getEntityTrail = asyncHandler(async (req, res) => {
  const { entityType, entityId } = req.params;
  const result = await auditService.getEntityTrail(entityType, entityId, req.validatedQuery);

  sendOk(res, AUDIT_MESSAGES.FETCHED, result);
});

export const getAuditEntry = asyncHandler(async (req, res) => {
  const entry = await auditService.getAuditEntry(req.params.id);
  sendOk(res, AUDIT_MESSAGES.ENTRY_FETCHED, { entry });
});

export const getAuditStatistics = asyncHandler(async (req, res) => {
  const statistics = await auditService.getAuditStatistics(req.validatedQuery);
  sendOk(res, "Audit statistics fetched", statistics);
});

/**
 * The vocabulary the log uses, so the filter drop-downs are built from the
 * server's own list rather than a copy in the UI that goes out of date the
 * first time an action is added.
 */
export const getAuditOptions = asyncHandler(async (req, res) => {
  sendOk(res, "Audit options fetched", {
    actions: AUDIT_ACTION_VALUES,
    entityTypes: Object.values(AUDIT_ENTITIES),
  });
});
