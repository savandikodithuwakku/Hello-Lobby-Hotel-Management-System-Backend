/**
 * One-off migration: one room status becomes two.
 *
 * Rooms used to carry a single `status` field that mixed up two different
 * facts - whether somebody was in the room, and whether it was fit to sell.
 * They are now separate fields, `occupancy` and `housekeeping`. Rooms already
 * in the database still have the old field, so this translates them.
 *
 * Run it once, after pulling the change:
 *
 *   npm run migrate:room-statuses
 *
 * It is safe to run twice. Rooms that already have both new fields are skipped,
 * so an interrupted run can simply be started again.
 */
import mongoose from "mongoose";
import env, { assertEnvIsValid } from "../config/env.js";
import { connectDB, disconnectDB } from "../config/database.js";
import { HOUSEKEEPING_STATUSES, OCCUPANCY_STATUSES } from "../modules/room/room.constants.js";

/**
 * How each old status splits.
 *
 * The judgement calls worth stating:
 *
 *  - `available` becomes vacant and *inspected*. These rooms were being sold
 *    yesterday, so calling them dirty would take the whole hotel off sale.
 *  - `reserved` and `occupied` say nothing about cleanliness. The guest in the
 *    room has been sleeping in it, so it is treated as dirty and housekeeping
 *    picks it up on the next round - the safe direction to be wrong in.
 *  - `cleaning` was already a housekeeping state; the room was empty.
 *  - `maintenance` and `out_of_service` both meant "do not sell", which is
 *    exactly what out of order means now.
 */
const TRANSLATION = Object.freeze({
  available: {
    occupancy: OCCUPANCY_STATUSES.VACANT,
    housekeeping: HOUSEKEEPING_STATUSES.INSPECTED,
  },
  reserved: {
    occupancy: OCCUPANCY_STATUSES.RESERVED,
    housekeeping: HOUSEKEEPING_STATUSES.INSPECTED,
  },
  occupied: {
    occupancy: OCCUPANCY_STATUSES.OCCUPIED,
    housekeeping: HOUSEKEEPING_STATUSES.DIRTY,
  },
  cleaning: {
    occupancy: OCCUPANCY_STATUSES.VACANT,
    housekeeping: HOUSEKEEPING_STATUSES.CLEANING,
  },
  maintenance: {
    occupancy: OCCUPANCY_STATUSES.VACANT,
    housekeeping: HOUSEKEEPING_STATUSES.OUT_OF_ORDER,
  },
  out_of_service: {
    occupancy: OCCUPANCY_STATUSES.VACANT,
    housekeeping: HOUSEKEEPING_STATUSES.OUT_OF_ORDER,
  },
});

/** A room with no old status at all - safest to assume it needs servicing. */
const FALLBACK = Object.freeze({
  occupancy: OCCUPANCY_STATUSES.VACANT,
  housekeeping: HOUSEKEEPING_STATUSES.DIRTY,
});

const run = async () => {
  assertEnvIsValid();
  await connectDB();

  // Read straight from the collection: the old `status` field is no longer in
  // the schema, so Mongoose would strip it out of a normal query.
  const collection = mongoose.connection.collection("rooms");
  const rooms = await collection.find({}, { projection: { status: 1, occupancy: 1 } }).toArray();

  let migrated = 0;
  let skipped = 0;
  const counts = {};

  for (const room of rooms) {
    if (room.occupancy) {
      skipped += 1;
      continue;
    }

    const next = TRANSLATION[room.status] ?? FALLBACK;

    await collection.updateOne(
      { _id: room._id },
      {
        $set: {
          occupancy: next.occupancy,
          housekeeping: next.housekeeping,
          housekeepingChangedAt: new Date(),
          occupancyChangedAt: new Date(),
        },
        // The old fields go, so nothing can quietly keep reading them.
        $unset: { status: "", statusNote: "", statusChangedAt: "", statusChangedBy: "" },
      }
    );

    const label = `${room.status ?? "(none)"} -> ${next.occupancy} + ${next.housekeeping}`;
    counts[label] = (counts[label] || 0) + 1;
    migrated += 1;
  }

  console.log(`\n${env.app.name}: room status migration`);
  console.log(`  migrated: ${migrated}`);
  console.log(`  already done, skipped: ${skipped}`);
  Object.entries(counts).forEach(([label, count]) => console.log(`    ${count} x ${label}`));

  await disconnectDB();
};

run().catch(async (error) => {
  console.error("Migration failed:", error.message);
  await disconnectDB();
  process.exit(1);
});
