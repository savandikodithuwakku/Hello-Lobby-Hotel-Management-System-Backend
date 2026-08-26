/**
 * Rounds an amount to two decimal places.
 *
 * Money is stored as a number, and floating point addition drifts over a long
 * stay (0.1 + 0.2 is not exactly 0.3). Every calculated amount goes through
 * here so a total never ends up a fraction of a cent out.
 */
export const money = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

export default money;
