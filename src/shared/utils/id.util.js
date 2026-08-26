/**
 * Reads the id out of a reference field.
 *
 * Mongoose gives back either a raw ObjectId or a populated document depending
 * on whether the query populated that path. Callers should not have to care,
 * so every `reservation.room?._id ?? reservation.room` in the services goes
 * through this instead.
 */
export const toId = (value) => (value && value._id ? value._id : value);

export default toId;
