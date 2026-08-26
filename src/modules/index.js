import { Router } from "express";
import authRoutes from "./auth/auth.routes.js";
import userRoutes from "./user/user.routes.js";
import roomTypeRoutes from "./room/roomType.routes.js";
import roomRoutes from "./room/room.routes.js";
import reservationRoutes from "./reservation/reservation.routes.js";
import paymentRoutes from "./payment/payment.routes.js";
import auditRoutes from "./audit/audit.routes.js";
import frontdeskRoutes from "./frontdesk/frontdesk.routes.js";
import ticketRoutes from "./frontdesk/ticket.routes.js";
import baggageRoutes from "./frontdesk/baggage.routes.js";

/**
 * Feature modules are mounted here and nowhere else. Adding a module means
 * adding exactly one line below.
 */
const modulesRouter = Router();

modulesRouter.use("/auth", authRoutes);
modulesRouter.use("/users", userRoutes);
modulesRouter.use("/room-types", roomTypeRoutes);
modulesRouter.use("/rooms", roomRoutes);
modulesRouter.use("/reservations", reservationRoutes);
modulesRouter.use("/payments", paymentRoutes);
modulesRouter.use("/audit", auditRoutes);
modulesRouter.use("/front-desk", frontdeskRoutes);
modulesRouter.use("/tickets", ticketRoutes);
modulesRouter.use("/baggage", baggageRoutes);

export default modulesRouter;
