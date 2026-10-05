import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchAllPages } from "./paging.js";

// A list served newest first, like the orders table, that can gain a sale
// partway through the read.
function server(total, { insertAfterRequests = null, withCount = true } = {}) {
  let rows = Array.from({ length: total }, (_, i) => ({ id: total - i }));
  let nextId = total + 1;
  let requests = 0;
  let open = 0;
  let mostOpen = 0;

  return {
    stats: () => ({ requests, mostOpen }),
    fetchPage: async (from, to, wantCount) => {
      requests += 1;
      open += 1;
      mostOpen = Math.max(mostOpen, open);
      await new Promise((resolve) => setTimeout(resolve, 2));

      const page = rows.slice(from, to + 1);
      if (requests === insertAfterRequests) {
        rows = [{ id: nextId }, ...rows];
        nextId += 1;
      }

      open -= 1;
      return { rows: page, count: wantCount && withCount ? rows.length : null };
    },
  };
}

const unique = (rows) => [...new Map(rows.map((row) => [row.id, row])).values()];
const SMALL = { pageSize: 10, parallel: 3 };

test("every row comes back once, newest first, whatever the total", async () => {
  for (const total of [0, 1, 9, 10, 11, 25, 30, 99, 100, 101]) {
    const list = server(total);
    const rows = await fetchAllPages(list.fetchPage, SMALL);

    assert.equal(rows.length, total, `${total} rows`);
    assert.deepEqual(
      rows.map((row) => row.id),
      Array.from({ length: total }, (_, i) => total - i),
      `${total} rows in order`
    );
  }
});

test("pages after the first are read several at a time, never more than allowed", async () => {
  const list = server(100);
  await fetchAllPages(list.fetchPage, SMALL);

  const { requests, mostOpen } = list.stats();
  assert.equal(requests, 11); // 10 full pages and the spare one
  assert.equal(mostOpen, 3);
});

test("a sale recorded during the read loses nothing", async () => {
  // The total is a whole number of pages: the case where the oldest row
  // would be pushed past the last page.
  for (const total of [20, 30, 25]) {
    for (const insertAfterRequests of [1, 2, 3]) {
      const list = server(total, { insertAfterRequests });
      const rows = unique(await fetchAllPages(list.fetchPage, SMALL));
      const ids = new Set(rows.map((row) => row.id));

      for (let id = 1; id <= total; id += 1) {
        assert.ok(ids.has(id), `row ${id} of ${total}, sale after request ${insertAfterRequests}`);
      }
    }
  }
});

test("without a total, pages are read in turn until a short one", async () => {
  const list = server(35, { withCount: false });
  const rows = await fetchAllPages(list.fetchPage, SMALL);

  assert.equal(rows.length, 35);
  assert.equal(list.stats().requests, 4);
});

test("a failed page fails the whole read", async () => {
  const list = server(50);
  const failing = async (from, to, withCount) => {
    if (from === 20) throw new Error("network");
    return list.fetchPage(from, to, withCount);
  };

  await assert.rejects(fetchAllPages(failing, SMALL), /network/);
});
