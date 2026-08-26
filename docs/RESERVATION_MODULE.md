# Reservation Management Module

Bookings: who is staying, in which room, for which nights, at what price, and
what they still owe. This module owns the booking; the room module owns the
room's live status and is driven by the hooks described below.

---

## 1. Folder structure

```
src/modules/reservation/
├── reservation.constants.js     Statuses, transitions, booking policy, date helpers
├── reservation.model.js         The booking, its money and its history
├── availability.service.js      The overlap rule and everything built on it
├── reservation.service.js       Booking rules and the lifecycle
├── reservation.controller.js
├── reservation.validation.js
└── reservation.routes.js        /api/v1/reservations
```

---

## 2. Availability, and how double booking is prevented

```
requested dates
     ↓
rooms that can be sold        active, not under maintenance or out of service,
     ↓                        belonging to an active room type
rooms big enough              room type maxOccupancy >= guests
     ↓
minus rooms with a live booking that overlaps
     ↓
available rooms  (each with a price quote for the stay)
```

The overlap rule, in one line:

```js
existing.checkIn < requested.checkOut && existing.checkOut > requested.checkIn
```

Stays are **half-open intervals of whole nights**. A guest leaving on the 10th
frees the room for a guest arriving on the 10th, so touching ranges are not a
clash - only shared nights are. Dates are stored as UTC midnights, so a 14:00
and a 22:00 arrival on the same day are the same night whatever timezone the
browser used.

Only `pending`, `confirmed` and `checked_in` bookings take part. A cancelled,
completed or no-show booking never blocks anything, which is why cancelling
frees the dates the instant it saves.

The live room status is deliberately **not** consulted for future dates: a room
with a guest in it today is perfectly bookable for next month. Only maintenance
and out-of-service rooms are excluded outright.

### Two defences, because one is not enough

1. `assertRoomIsAvailable` runs the overlap query before inserting and reports
   the reference of any booking in the way.
2. Two requests can pass that check in the same instant. Immediately after
   saving, `resolveInsertRace` looks again: if another live booking overlaps the
   same room, the one with the higher `_id` deletes itself and returns 409. The
   comparison is deterministic, so exactly one of a racing pair survives without
   a distributed lock or a transaction.

Both are covered by the integration suite, including two genuinely simultaneous
requests for the same room and dates.

---

## 3. The booking

| Field | Notes |
|---|---|
| `reference` | Human-readable, e.g. `RSV-20260826-4F7A`; unique |
| `customer` | The guest. Staff may book on behalf of one; a guest only for themselves |
| `room`, `roomType` | The type is denormalised so reports need no join |
| `checkIn`, `checkOut`, `nights` | UTC midnights; `nights` derived, never sent by the client |
| `guests` | Checked against the room type's `maxOccupancy` |
| `pricing.roomRate` | **Snapshot** of the nightly rate at booking time |
| `pricing.roomSubtotal` | `roomRate × nights` |
| `additionalServices` | `{ name, unitPrice, quantity }` lines |
| `pricing.totalAmount` | Room + services, recomputed server-side on every change |
| `payment.advanceAmount` | 20% of the total (`POLICY.ADVANCE_PERCENTAGE`) |
| `payment.amountPaid` | What has actually been received |
| `payment.balanceDue` | Derived: total − paid |
| `payment.advanceDeadline` | 48 hours after booking, or arrival day if sooner |
| `payment.balanceDeadline` | Arrival day |
| `history[]` | Every status change, with who and why |

Prices are snapshots on purpose: repricing a room tomorrow must never rewrite
what a guest already agreed to pay.

Amounts are never accepted from the client. `recalculateTotals()` derives every
figure from the rate, the nights and the service lines.

---

## 4. Lifecycle

```
                 advance paid
   pending ─────────────────────► confirmed ──────► checked_in ──────► checked_out
      │                               │                                     │
      ├──► cancelled                  ├──► cancelled                        ▼
      └──► no_show                    └──► no_show                     completed
                                                                    (balance settled)
```

| Status | Meaning |
|---|---|
| `pending` | Held, waiting for the advance |
| `confirmed` | Advance paid, the room is held |
| `checked_in` | The guest is in the room |
| `checked_out` | The guest has left; a balance may remain |
| `completed` | Closed and fully paid |
| `cancelled` | Called off; the dates are free again |
| `no_show` | The guest never arrived |

Rules the API enforces:

- **Confirming requires the advance.** `POST /:id/confirm` refuses until
  `amountPaid >= advanceAmount`, and reports how much is missing.
- **Paying the advance confirms automatically.** Recording a payment that
  reaches the advance flips `pending → confirmed` in the same request, so
  nobody has to remember a second step.
- **Completing requires a zero balance.** `POST /:id/complete` refuses while
  anything is owed and names the amount.
- **Editing stops at arrival.** Dates, room, guests and services can only be
  changed while `pending` or `confirmed`, and a change re-runs the overlap check
  with the booking excluded from its own comparison.
- **Repricing below what has been paid is refused**, so an overpayment can never
  appear silently; the refund belongs to the payments module.

---

## 5. How the room status follows the booking

The room module owns `status`; this module calls its hooks rather than writing
to rooms directly.

| Booking event | Room hook | Room ends up |
|---|---|---|
| Booking covers today, and is held | `reserveRoom` | `reserved` |
| Check-in | `checkInRoom` | `occupied` |
| Check-out | `releaseRoom` | `cleaning` |
| Cancellation / no-show while holding the room | `releaseRoom` | `available` |

A room's live status describes **today**. A booking for next month does not mark
the room reserved now - it would look unsellable for every other date. The hold
is applied when the booking is the one covering the current day, and at check-in
for anything booked earlier.

---

## 6. Permissions

| Action | Permission |
|---|---|
| Search availability | `reservation:create` or `reservation:read` |
| List / view bookings | `reservation:read` (all) or `reservation:read_own` (own) |
| Create | `reservation:create` |
| Edit | `reservation:update` |
| Confirm, no-show, complete | `reservation:update` |
| Cancel | `reservation:cancel`, or being the guest who booked it |
| Check in / out | `frontdesk:checkin` / `frontdesk:checkout` |
| Record a payment | `payment:create` |
| Occupancy and statistics | `reservation:read` |

Guests are narrowed rather than blocked: the same list and detail endpoints
return only their own bookings, and someone else's booking is a **404** rather
than a 403 so references cannot be probed.

---

## 7. API reference

Base URL `/api/v1/reservations`.

| Method | Path | Notes |
|---|---|---|
| GET | `/availability` | `checkIn`, `checkOut`, `roomType?`, `guests?`, `floor?` — free rooms with a quote |
| GET | `/occupancy` | Night-by-night booked/free counts |
| GET | `/statistics` | Arrivals, departures, in-house, outstanding balance |
| GET | `/` | `search`, `status`, `customer`, `room`, `roomType`, `from`, `to`, `unpaid`, `sort`, `page`, `limit` |
| POST | `/` | Creates a `pending` booking |
| GET | `/:id` | Includes `allowedTransitions` |
| GET | `/:id/history` | The audit trail |
| PATCH | `/:id` | Dates, room, guests, services, requests |
| POST | `/:id/confirm` | Requires the advance |
| POST | `/:id/cancel` | Frees the dates immediately |
| POST | `/:id/check-in` | Room becomes occupied |
| POST | `/:id/check-out` | Room goes to cleaning |
| POST | `/:id/complete` | Requires a zero balance |
| POST | `/:id/no-show` | Only after the check-in date |
| PATCH | `/:id/payment` | Records money; may auto-confirm |

`from`/`to` filter by the same overlap rule: a stay is returned when it touches
the window, not only when it starts inside it.

---

## 8. Note on Express 5 and query parameters

Express 5 made `req.query` a read-only getter, so express-validator's
`toInt`, `toBoolean` and `toDate` sanitisers cannot write back to it and a
handler reading `req.query` would still see raw strings. The shared
`validateRequest` middleware therefore attaches `req.validatedQuery`
(`matchedData`), and **every handler with typed query parameters must read
that**, not `req.query`. `req.body` and `req.params` are ordinary properties and
are sanitised in place as usual.

This was found by the reservation suite - the `unpaid=true` filter silently did
nothing - and the same fix was applied to the rooms, room types and users lists.

---

## 9. What the payments module will take over

`PATCH /:id/payment` is the provisional home for recording money. The payments
module will own the gateway, receipts, refunds and the payment ledger, and will
call `recordPayment` in this service rather than writing to the reservation, so
the confirm-on-advance rule stays in one place.
