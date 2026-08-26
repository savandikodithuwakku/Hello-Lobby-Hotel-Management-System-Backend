# Room Management Module

The hotel's inventory: the **catalogue** of room types and the **physical rooms**
that belong to them. Deliberately independent of reservations - this module owns
what a room *is* and what state it is in; the reservation module will own who is
staying in it.

---

## 1. Folder structure

```
src/modules/room/
├── room.constants.js       Statuses, the transition map, limits, sort options
├── roomType.model.js       Catalogue entry: price, occupancy, facilities, images
├── room.model.js           Physical room: number, floor, status, price override
├── roomType.service.js     Catalogue rules
├── room.service.js         Inventory rules + the room state machine
├── roomType.controller.js
├── room.controller.js
├── room.validation.js      express-validator schemas for both resources
├── roomType.routes.js      /api/v1/room-types
└── room.routes.js          /api/v1/rooms
```

Same layering as every other module: **routes → controller → service → model**.

---

## 2. Room types

A room type is the template. Standard, Deluxe, Luxury, Suite, Family,
Presidential - whatever the hotel sells.

| Field | Notes |
|---|---|
| `name` | Unique, case-insensitively: "Deluxe" and "deluxe" are the same type |
| `description` | Shown to guests browsing the catalogue |
| `basePrice` | What every room of this type charges unless it overrides it |
| `maxOccupancy` | How many guests the room sleeps |
| `facilities` | Trimmed, de-duplicated case-insensitively, blanks dropped |
| `images` | `{ url, alt, isPrimary }`; exactly one primary is enforced on save |
| `isActive` | Soft delete - a withdrawn type is never removed |

**Withdrawing a type** is refused while active rooms still use it. The operator
must move or remove those rooms first, so no room is left pointing at a
catalogue entry that no longer sells.

---

## 3. Rooms

| Field | Notes |
|---|---|
| `roomNumber` | Unique across the hotel, stored upper case, letters/digits/hyphens |
| `roomType` | Reference to the catalogue entry |
| `floor` | `0` is the ground floor, negatives are basements |
| `status` | The state machine below |
| `price` | **Override only.** `null` means "charge the type's base price" |
| `facilities` | Extras this room has *on top of* its type's list |
| `isActive` | Soft delete |

Two derived values travel with every room payload:

- `effectivePrice` - the room's own price, or the type's base price.
- `effectiveFacilities` - the type's facilities merged with the room's extras.

So a Deluxe corner room can charge more than the rest of its type without
duplicating everything else the type already describes.

---

## 4. The room state machine

```
available ──┬─► cleaning ──┬─► available
            │              ├─► maintenance
            ├─► maintenance┤
            └─► out_of_service ──► maintenance / cleaning / available

    (reservation module only)
available ──► reserved ──► occupied ──► cleaning ──► available
                  │
                  └─ cancelled ──► available
```

| Status | Meaning |
|---|---|
| `available` | Bookable right now |
| `reserved` | A confirmed booking holds it |
| `occupied` | A guest is in it |
| `cleaning` | Housekeeping is turning it over |
| `maintenance` | Being repaired, back soon |
| `out_of_service` | Withdrawn from use indefinitely |

### Who may set what

`reserved` and `occupied` are **never set by hand**. `PATCH /rooms/:id/status`
refuses them outright. They are set by the reservation and check-in flows through
service functions the room module exports:

```js
import { reserveRoom, checkInRoom, releaseRoom } from "../room/room.service.js";

await reserveRoom(roomId, { actorId, note: `Booking ${booking.reference}` });
await checkInRoom(roomId, { actorId });
await releaseRoom(roomId, { actorId, note: "Checked out" });
```

`releaseRoom` is what makes **availability come back on its own**:

- a **cancelled** booking (`reserved`) frees the room straight to `available`;
- a **departure** (`occupied`) sends it to `cleaning` first, and housekeeping
  marks it available once the room is ready.

Anything else - a room already under maintenance - is left untouched.

Every room detail response carries `allowedTransitions`, the exact list the API
will accept next, so the UI never offers a move the server would refuse.

---

## 5. Soft deletion

Nothing in this module is ever hard-deleted.

- `DELETE /rooms/:id` sets `isActive: false` and parks the room in
  `out_of_service`. It disappears from availability, and reservations that
  reference room 205 still resolve to a real room.
- A room that is `reserved` or `occupied` **cannot** be removed - the guest has
  to check out first.
- Room numbers stay reserved after removal. Creating 205 again is refused with a
  message pointing at restore, rather than silently producing a second 205.
- `POST /rooms/:id/restore` brings it back as `cleaning`, never straight to
  `available`: a room that has been out of service should be checked before a
  guest is sent to it. Restoring is refused while its type is withdrawn.

---

## 6. Permissions

| Permission | Super Admin | Admin | Staff | Customer |
|---|:--:|:--:|:--:|:--:|
| `room_type:read` | ✓ | ✓ | ✓ | ✓ |
| `room_type:create` / `:update` / `:delete` | ✓ | ✓ | | |
| `room:read` | ✓ | ✓ | ✓ | |
| `room:create` / `:update` / `:delete` | ✓ | ✓ | | |
| `room:manage_status` | ✓ | ✓ | ✓ | |

`room:manage_status` is split out from `room:update` on purpose: front-desk staff
move rooms through the housekeeping cycle all day, but must not be able to
reprice a room, renumber it or change its type.

### Guests never see the inventory

A customer holds `room_type:read` and **not** `room:read`, which is the line
between browsing the catalogue and seeing the hotel's inventory. The reason is
not tidiness:

- live room statuses reveal which rooms are occupied and which are empty, which
  is a physical-security matter for the guests already staying there;
- `GET /rooms/statistics` exposes the occupancy rate, which is commercially
  sensitive;
- maintenance notes name specific faults in specific rooms;
- per-room price overrides show one guest paying more than another for what
  looks like the same room.

`room:read` therefore also decides **how much of a room type** comes back.
`roomType.service.js` calls this `canSeeInventory`, and a caller without it gets
`toPublicObject()`: name, description, base price, occupancy, facilities and
images, with no room counts, no `isActive` and no audit timestamps. Withdrawn
types are filtered out of the list whatever the query string says, and requesting
one directly is a 404 - it is not for sale, so as far as a guest is concerned it
does not exist.

Guests browse at `/browse` in the SPA, which shows the catalogue as cards. Room
numbers and statuses appear nowhere in it; a guest is assigned a room at
check-in.

---

## 7. API reference

Base URL `/api/v1`. Every route requires a valid access token.

### Room types

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/room-types` | `room_type:read` | `search`, `isActive`, `minPrice`, `maxPrice`, `occupancy`, `sort`, `page`, `limit`; each row carries `roomCount` |
| POST | `/room-types` | `room_type:create` | |
| GET | `/room-types/:id` | `room_type:read` | Adds `roomCount` and `activeRoomCount` |
| PATCH | `/room-types/:id` | `room_type:update` | Partial; `isActive` is ignored here |
| DELETE | `/room-types/:id` | `room_type:delete` | Soft delete; refused while active rooms use it |
| POST | `/room-types/:id/restore` | `room_type:update` | |

### Rooms

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/rooms` | `room:read` | `search`, `roomType`, `status`, `floor`, `isActive`, `minPrice`, `maxPrice`, `sort`, `page`, `limit` |
| GET | `/rooms/available` | `room:read` | Bookable **right now**; `roomType`, `floor`, `occupancy` |
| GET | `/rooms/statistics` | `room:read` | Counts per status and per type, plus occupancy rate |
| POST | `/rooms` | `room:create` | Cannot start out reserved or occupied |
| GET | `/rooms/:id` | `room:read` | Includes `allowedTransitions` |
| PATCH | `/rooms/:id` | `room:update` | Number, type, floor, price, facilities. Refused for a room in use |
| PATCH | `/rooms/:id/status` | `room:manage_status` | Housekeeping moves only |
| DELETE | `/rooms/:id` | `room:delete` | Soft delete, optional `note` |
| POST | `/rooms/:id/restore` | `room:delete` | Returns the room as `cleaning` |

The price filters match inherited prices too: a room with no override is matched
on its type's base price, so `minPrice=20000` does not silently miss rooms that
follow their type.

---

## 8. What the reservation module will add

This module answers "is room 205 free *right now*". Availability across a date
range depends on bookings, so `GET /rooms/available` will become the first step
of that query: the reservation module takes this set and removes the rooms whose
bookings overlap the requested dates.

The room's status stays the room module's business. Reservations will call
`reserveRoom` / `checkInRoom` / `releaseRoom` rather than writing `status`
directly, which keeps the state machine in one place.
