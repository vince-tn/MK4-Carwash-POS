/*
 * Reads every row of a list that the server hands out a page at a time.
 *
 * PostgREST returns at most 1000 rows per request. Reading the pages one
 * after another made the wait grow with every sale ever recorded: about 22
 * round trips after a year at the shop's 60-car quota. Here the first page
 * also brings the total, and the remaining pages are read several at once.
 *
 * fetchPage(from, to, withCount) resolves to { rows, count }; count is only
 * needed when withCount is true. Rows come back in page order. A sale
 * recorded while the pages are read pushes later rows one place down, so the
 * caller must drop duplicates by id (db.fetchOrders does).
 */
export async function fetchAllPages(fetchPage, { pageSize = 1000, parallel = 6 } = {}) {
  const first = await fetchPage(0, pageSize - 1, true);
  if (first.rows.length < pageSize) return first.rows;

  // One page more than the total needs: a sale recorded in the meantime
  // pushes the oldest row onto it. Without a total, read the pages in turn.
  const pageCount = Number.isFinite(first.count)
    ? Math.floor(Math.max(first.count, pageSize) / pageSize) + 1
    : 2;

  const pages = new Array(pageCount);
  pages[0] = first.rows;

  async function read(index) {
    const { rows } = await fetchPage(index * pageSize, (index + 1) * pageSize - 1, false);
    pages[index] = rows;
  }

  let next = 1;
  async function reader() {
    while (next < pageCount) {
      const index = next;
      next += 1;
      await read(index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(parallel, pageCount - 1) }, reader)
  );

  // Still a full last page: more sales arrived than the spare page covers.
  // Carry on one page at a time until a short one.
  while (pages[pages.length - 1].length === pageSize) {
    await read(pages.length);
  }

  return pages.flat();
}
