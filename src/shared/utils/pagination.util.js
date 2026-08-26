import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../constants/pagination.constants.js";

/**
 * Turns the caller's `page` and `limit` into safe numbers a query can use.
 *
 * The validators already reject anything out of range, but a service is also
 * called from scripts and from other services, so the clamping is repeated
 * here: a service should never be able to receive a page size of 10 000.
 */
export const resolvePaging = ({ page, limit } = {}) => {
  const safeLimit = Math.min(Number(limit) || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const safePage = Math.max(Number(page) || 1, 1);

  return {
    page: safePage,
    limit: safeLimit,
    /** How many documents to step over to reach the requested page. */
    skip: (safePage - 1) * safeLimit,
  };
};

/**
 * The `pagination` block every list response carries, so the client always
 * receives the same shape no matter which module answered.
 */
export const buildPagination = ({ page, limit, total }) => ({
  page,
  limit,
  total,
  // Always at least one page, so an empty list still reads as "page 1 of 1".
  totalPages: Math.ceil(total / limit) || 1,
});

/**
 * Runs a paged find and its count together and returns both the documents and
 * the ready-made pagination block.
 *
 * `decorate` lets a caller add populates or extra query options to the find
 * before it runs, which is how the room and reservation modules attach their
 * related documents.
 */
export const paginateQuery = async (Model, filter, { page, limit, sort, decorate } = {}) => {
  const paging = resolvePaging({ page, limit });

  const query = Model.find(filter).sort(sort).skip(paging.skip).limit(paging.limit);

  const [documents, total] = await Promise.all([
    decorate ? decorate(query) : query,
    Model.countDocuments(filter),
  ]);

  return { documents, pagination: buildPagination({ ...paging, total }) };
};
