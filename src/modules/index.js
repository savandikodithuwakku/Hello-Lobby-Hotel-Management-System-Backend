import { Router } from "express";
import authRoutes from "./auth/auth.routes.js";
import userRoutes from "./user/user.routes.js";
import roomTypeRoutes from "./room/roomType.routes.js";
import roomRoutes from "./room/room.routes.js";
import reservationRoutes from "./reservation/reservation.routes.js";

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

export default modulesRouter;
