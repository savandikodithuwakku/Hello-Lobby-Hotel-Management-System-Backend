/**
 * Field definitions that several models need to spell the same way.
 *
 * Mongoose schemas are plain objects, so a field that four models share can be
 * written once here and spread into each of them. Keeping them together means a
 * rule like "a reference is always stored in upper case" is decided in one
 * place instead of drifting apart across the modules.
 */

/**
 * The short, human-readable code a document is known by outside the system -
 * a booking reference, a receipt number, the tag on a piece of luggage.
 *
 * It is deliberately not the database id. Somebody has to be able to read it
 * out over a desk or write it on a paper tag, so it is short, always stored in
 * upper case, and unique so it can be searched on with confidence.
 */
export const referenceField = () => ({
  type: String,
  required: true,
  unique: true,
  uppercase: true,
  trim: true,
});

/**
 * A free-text remark a member of staff can leave on a record.
 *
 * Always optional and always defaulted to an empty string, so code reading the
 * note never has to guard against `undefined`. The maximum length differs by
 * module, so each caller passes its own limit from its policy constants.
 */
export const noteField = (maxLength) => ({
  type: String,
  trim: true,
  maxlength: [maxLength, "Note is too long"],
  default: "",
});
