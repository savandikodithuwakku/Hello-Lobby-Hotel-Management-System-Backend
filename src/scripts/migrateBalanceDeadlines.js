/**
 * One-off migration: the balance is due on departure, not on arrival.
 *
 * Bookings used to store their balance deadline as the check-in date, from a
 * time when the whole stay was expected to be paid for before the guest walked
 * in. The rule is now the one a hotel actually uses - the advance holds the
 * room, and everything else is settled at the desk on the way out - and
 * check-out refuses to let a guest leave with anything outstanding.
 *
 * Bookings made before that change still carry the old deadline, which makes
 * their bill read as overdue for the whole stay even though the guest is paying
 * exactly when they are supposed to. This moves those deadlines to the
 * check-out date and brings their invoices along with them.
 *
 * Run it once:
 *
 *   npm run migrate:balance-deadlines
 *
 * Safe to run twice: a booking whose deadline is already its check-out date is
 * skipped, so an interrupted run can simply be started again.
 */
import mongoose from "mongoose";
import env, { assertEnvIsValid } from "../config/env.js";
import { connectDB, disconnectDB } from "../config/database.js";
import Reservation from "../modules/reservation/reservation.model.js";
import Invoice from "../modules/payment/invoice.model.js";
import { TERMINAL_STATUSES } from "../modules/reservation/reservation.constants.js";
import { toDateString } from "../shared/utils/date.util.js";

const sameDay = (a, b) => a && b && new Date(a).getTime() === new Date(b).getTime();

const run = async () => {
  assertEnvIsValid();
  await connectDB();

  /**
   * Only bookings that are still live are touched.
   *
   * A cancelled, completed or no-show booking is closed: its deadline no longer
   * decides anything, and moving it would be rewriting a record for no benefit.
   * Those are counted and reported rather than edited.
   */
  const reservations = await Reservation.find({}).select(
    "reference status checkOut payment.balanceDeadline"
  );

  let updated = 0;
  let alreadyCorrect = 0;
  let closed = 0;
  const moved = [];

  for (const reservation of reservations) {
    if (sameDay(reservation.payment.balanceDeadline, reservation.checkOut)) {
      alreadyCorrect += 1;
      continue;
    }

    if (TERMINAL_STATUSES.includes(reservation.status)) {
      closed += 1;
      continue;
    }

    const from = reservation.payment.balanceDeadline;

    // Written straight to the field rather than through the model's save hooks,
    // so nothing else about the booking - its totals, its history - is touched.
    await Reservation.updateOne(
      { _id: reservation._id },
      { $set: { "payment.balanceDeadline": reservation.checkOut } }
    );

    // The invoice copies this deadline, and only re-reads it when the payments
    // module next touches the bill. Updating it here means a bill stops
    // claiming to be overdue immediately rather than at some later moment.
    await Invoice.updateOne(
      { reservation: reservation._id },
      { $set: { dueAt: reservation.checkOut } }
    );

    moved.push(
      `${reservation.reference}: ${toDateString(from)} -> ${toDateString(reservation.checkOut)}`
    );
    updated += 1;
  }

  console.log(`\n${env.app.name}: balance deadline migration`);
  console.log(`  moved to the check-out date: ${updated}`);
  console.log(`  already correct, skipped:    ${alreadyCorrect}`);
  console.log(`  closed bookings, left alone: ${closed}`);
  moved.forEach((line) => console.log(`    ${line}`));

  await disconnectDB();
};

run().catch(async (error) => {
  console.error("Migration failed:", error.message);
  await disconnectDB();
  process.exit(1);
});
