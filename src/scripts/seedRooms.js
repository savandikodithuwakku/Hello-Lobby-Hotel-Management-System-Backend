/**
 * Seeds a starter inventory: the room-type catalogue and the rooms themselves.
 *
 *   npm run seed:rooms
 *
 * Idempotent by design. Types are matched by name and rooms by number, so
 * running it twice only reports what already exists - it never duplicates a
 * room or overwrites a price you have since changed.
 */
import { assertEnvIsValid } from "../config/env.js";
import connectDB, { disconnectDB } from "../config/database.js";
import User from "../modules/user/user.model.js";
import RoomType from "../modules/room/roomType.model.js";
import Room from "../modules/room/room.model.js";
import { USER_ROLES } from "../modules/user/user.constants.js";
import { ROOM_STATUSES } from "../modules/room/room.constants.js";

/**
 * Photographs come from Unsplash's image CDN, which serves a stable URL per
 * photo and resizes it on request. They are stand-ins for the hotel's own
 * photography - replace the URLs from the room type screen when real photos
 * exist. The rendering parameters live here so every seeded image is requested
 * at the same size and quality.
 */
const photo = (id, alt, isPrimary = false) => ({
  url: `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=1400&q=80`,
  alt,
  isPrimary,
});

/**
 * The catalogue. Prices are in the currency the app displays (LKR by default);
 * adjust them here or in the UI afterwards.
 */
const ROOM_TYPES = [
  {
    name: "Standard",
    description:
      "A comfortable room with everything a short stay needs. Queen bed, work desk and an en-suite bathroom.",
    basePrice: 8000,
    maxOccupancy: 2,
    facilities: ["Air conditioning", "Free Wi-Fi", "Smart TV", "Work desk", "En-suite bathroom"],
    images: [
      photo("1631049307264-da0ec9d70304", "Standard room with a queen bed and bedside lamps", true),
      photo("1522771739844-6a9f6d5f14af", "Bright, uncluttered sleeping area"),
      photo("1587985064135-0366536eab42", "Standard room seen from the doorway"),
    ],
  },
  {
    name: "Deluxe",
    description:
      "More space and a better outlook, with a seating area and a private balcony overlooking the grounds.",
    basePrice: 15000,
    maxOccupancy: 3,
    facilities: [
      "Air conditioning",
      "Free Wi-Fi",
      "Smart TV",
      "Private balcony",
      "Mini bar",
      "Seating area",
      "Tea and coffee",
    ],
    images: [
      photo("1618773928121-c32242e63f39", "Deluxe room with a king bed and panelled headboard", true),
      photo("1591088398332-8a7791972843", "Seating area and writing desk in a deluxe room"),
      photo("1611892440504-42a792e24d32", "Deluxe room opening onto a private balcony"),
    ],
  },
  {
    name: "Luxury",
    description:
      "A premium room with a king bed, a rain shower and lounge access, for guests who want a little more.",
    basePrice: 25000,
    maxOccupancy: 3,
    facilities: [
      "Air conditioning",
      "Free Wi-Fi",
      "Smart TV",
      "King bed",
      "Rain shower",
      "Mini bar",
      "Bathrobes",
      "Executive lounge access",
    ],
    images: [
      photo("1566665797739-1674de7a421a", "Luxury room with a king bed and dark timber finishes", true),
      photo("1578683010236-d716f9a3f461", "Floor-to-ceiling glazing beside the bed"),
      photo("1590490360182-c33d57733427", "Upholstered seating in a luxury room"),
    ],
  },
  {
    name: "Family",
    description:
      "Two connected bedrooms and a shared living space, built for families travelling together.",
    basePrice: 32000,
    maxOccupancy: 6,
    facilities: [
      "Air conditioning",
      "Free Wi-Fi",
      "Two bedrooms",
      "Living area",
      "Two bathrooms",
      "Kitchenette",
      "Child cot available",
    ],
    images: [
      photo("1615874959474-d609969a20ed", "Family room bedroom with warm daylight", true),
      photo("1505693416388-ac5ce068fe85", "The second bedroom of a family room"),
      photo("1600210492486-724fe5c67fb0", "Shared living space between the two bedrooms"),
    ],
  },
  {
    name: "Suite",
    description:
      "A separate living room, a dining table for four and a bedroom with a sea view. Ideal for longer stays.",
    basePrice: 40000,
    maxOccupancy: 4,
    facilities: [
      "Air conditioning",
      "Free Wi-Fi",
      "Separate living room",
      "Dining area",
      "Sea view",
      "Mini bar",
      "Bathtub",
      "Espresso machine",
    ],
    images: [
      photo("1616594039964-ae9021a400a0", "Suite bedroom with a chandelier and lounge seating", true),
      photo("1618221195710-dd6b41faaea6", "The suite's separate living room"),
      photo("1582719478250-c89cae4dc85b", "Bedroom opening onto the terrace"),
    ],
  },
  {
    name: "Presidential",
    description:
      "The top floor in its entirety: private terrace, dining for eight, butler service and airport transfers.",
    basePrice: 95000,
    maxOccupancy: 4,
    facilities: [
      "Air conditioning",
      "Free Wi-Fi",
      "Private terrace",
      "Dining for eight",
      "Butler service",
      "Airport transfer",
      "Jacuzzi",
      "Panoramic view",
    ],
    images: [
      photo("1602002418082-a4443e081dd1", "Presidential suite living room facing the water", true),
      photo("1613977257363-707ba9348227", "Private terrace and plunge pool"),
      photo("1566073771259-6a8506099945", "The resort pool reserved for presidential guests"),
    ],
  },
];

/**
 * The building. Each entry lays out one floor: which type, which numbers, and
 * any room that is priced differently from its type (a corner room with the
 * better view).
 */
const FLOOR_PLAN = [
  { floor: 1, type: "Standard", from: 101, to: 108 },
  { floor: 2, type: "Standard", from: 201, to: 204 },
  { floor: 2, type: "Deluxe", from: 205, to: 210 },
  { floor: 3, type: "Deluxe", from: 301, to: 306 },
  { floor: 3, type: "Family", from: 307, to: 310 },
  { floor: 4, type: "Luxury", from: 401, to: 406 },
  { floor: 4, type: "Suite", from: 407, to: 410 },
  { floor: 5, type: "Suite", from: 501, to: 504 },
  { floor: 5, type: "Presidential", from: 505, to: 505 },
];

/** Rooms that charge more than their type, with the reason for the premium. */
const PRICE_OVERRIDES = {
  "210": { price: 17500, facilities: ["Corner room", "Extra balcony"] },
  "310": { price: 35000, facilities: ["Garden view", "Connecting door"] },
  "410": { price: 45000, facilities: ["Corner suite", "Wraparound balcony"] },
  "504": { price: 46000, facilities: ["Top floor", "Uninterrupted sea view"] },
};

const expand = ({ floor, type, from, to }) => {
  const rooms = [];
  for (let number = from; number <= to; number += 1) {
    rooms.push({ roomNumber: String(number), floor, type });
  }
  return rooms;
};

const run = async () => {
  assertEnvIsValid();
  await connectDB();

  // Attribute the seeded records to the super admin when there is one, so the
  // audit fields are not empty.
  const owner = await User.findOne({ role: USER_ROLES.SUPER_ADMIN }).sort("createdAt");

  if (owner) {
    console.log(`Attributing seeded records to ${owner.email}\n`);
  } else {
    console.log("No super admin found; seeded records will have no creator.\n");
  }

  /* --------------------------- Room types ------------------------------- */

  const typesByName = new Map();
  let typesCreated = 0;
  let imagesBackfilled = 0;

  for (const definition of ROOM_TYPES) {
    // Case-insensitive, matching the uniqueness rule the API enforces.
    const existing = await RoomType.findOne({
      name: new RegExp(`^${definition.name}$`, "i"),
    });

    if (existing) {
      typesByName.set(definition.name, existing);

      // Backfill photographs onto a type seeded before the images existed.
      // Only when it has none, so photographs chosen in the UI are never
      // overwritten by re-running the seed.
      if (existing.images.length === 0 && definition.images?.length) {
        existing.images = definition.images;
        existing.updatedBy = owner?._id ?? existing.updatedBy;
        await existing.save();
        imagesBackfilled += 1;
        console.log(`  ~ room type "${definition.name}" already exists, added ${definition.images.length} photographs`);
        continue;
      }

      console.log(`  = room type "${definition.name}" already exists`);
      continue;
    }

    const created = await RoomType.create({
      ...definition,
      createdBy: owner?._id ?? null,
      updatedBy: owner?._id ?? null,
    });

    typesByName.set(definition.name, created);
    typesCreated += 1;
    console.log(`  + room type "${definition.name}" (${definition.basePrice}, sleeps ${definition.maxOccupancy})`);
  }

  /* ------------------------------ Rooms --------------------------------- */

  console.log("");
  const planned = FLOOR_PLAN.flatMap(expand);
  let roomsCreated = 0;
  let roomsSkipped = 0;

  for (const { roomNumber, floor, type } of planned) {
    const roomType = typesByName.get(type);

    if (!roomType) {
      console.warn(`  ! no room type "${type}" for room ${roomNumber}, skipped`);
      continue;
    }

    if (await Room.exists({ roomNumber })) {
      roomsSkipped += 1;
      continue;
    }

    const override = PRICE_OVERRIDES[roomNumber];

    await Room.create({
      roomNumber,
      roomType: roomType._id,
      floor,
      status: ROOM_STATUSES.AVAILABLE,
      price: override?.price ?? null,
      facilities: override?.facilities ?? [],
      statusChangedBy: owner?._id ?? null,
      createdBy: owner?._id ?? null,
      updatedBy: owner?._id ?? null,
    });

    roomsCreated += 1;
  }

  /* ----------------------------- Summary -------------------------------- */

  const [totalTypes, totalRooms] = await Promise.all([
    RoomType.countDocuments({ isActive: true }),
    Room.countDocuments({ isActive: true }),
  ]);

  console.log("");
  console.log(`Room types: ${typesCreated} created, ${ROOM_TYPES.length - typesCreated} already present`);
  if (imagesBackfilled > 0) {
    console.log(`            ${imagesBackfilled} existing type(s) had photographs added`);
  }
  console.log(`Rooms:      ${roomsCreated} created, ${roomsSkipped} already present`);
  console.log(`Inventory now holds ${totalRooms} active rooms across ${totalTypes} active types.`);
  console.log("");
  console.log("Photographs are Unsplash stand-ins - replace them from the room type screen.");
};

run()
  .catch((error) => {
    console.error("Seeding failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDB();
  });
