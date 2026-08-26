import { Router } from "express";
import { authenticate } from "../auth/auth.middleware.js";
import { requirePermission } from "../auth/rbac/rbac.middleware.js";
import { PERMISSIONS } from "../auth/rbac/permissions.js";
import { validateRequest } from "../../shared/middleware/validate.middleware.js";
import * as baggageController from "./baggage.controller.js";
import {
  baggageIdValidation,
  collectBaggageValidation,
  listBaggageValidation,
  storeBaggageValidation,
  tagValidation,
  updateBaggageValidation,
} from "./baggage.validation.js";

/**
 * Baggage held at the desk.
 *
 * Taking bags in and handing them back is desk work, so it needs
 * `frontdesk:baggage_manage`. A guest can see what is being held for them -
 * the same read endpoints, narrowed by the service - but cannot record a
 * hand-over, because the whole point is that a member of staff witnessed it.
 */
const router = Router();

const READ_BAGGAGE = [PERMISSIONS.FRONTDESK_BAGGAGE_MANAGE, PERMISSIONS.RESERVATION_READ_OWN];

router.use(authenticate);

/** Declared before `/:id` so "statistics" is not read as a record id. */
router.get(
  "/statistics",
  requirePermission(PERMISSIONS.FRONTDESK_BAGGAGE_MANAGE),
  baggageController.getBaggageStatistics
);

/** The counter lookup: somebody hands over a paper tag. */
router.get(
  "/tag/:tag",
  requirePermission(...READ_BAGGAGE),
  tagValidation,
  validateRequest,
  baggageController.getBaggageByTag
);

router.get(
  "/",
  requirePermission(...READ_BAGGAGE),
  listBaggageValidation,
  validateRequest,
  baggageController.listBaggage
);

router.post(
  "/",
  requirePermission(PERMISSIONS.FRONTDESK_BAGGAGE_MANAGE),
  storeBaggageValidation,
  validateRequest,
  baggageController.storeBaggage
);

router.get(
  "/:id",
  requirePermission(...READ_BAGGAGE),
  baggageIdValidation,
  validateRequest,
  baggageController.getBaggage
);

router.patch(
  "/:id",
  requirePermission(PERMISSIONS.FRONTDESK_BAGGAGE_MANAGE),
  updateBaggageValidation,
  validateRequest,
  baggageController.updateBaggage
);

/** Handing the bags over. Staff only, and who took them is written down. */
router.post(
  "/:id/collect",
  requirePermission(PERMISSIONS.FRONTDESK_BAGGAGE_MANAGE),
  collectBaggageValidation,
  validateRequest,
  baggageController.collectBaggage
);

export default router;
