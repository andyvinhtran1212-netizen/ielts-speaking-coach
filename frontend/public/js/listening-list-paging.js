/**
 * frontend/js/listening-list-paging.js
 *
 * Shared paging for the listening list pages. Deliberately side-effect free:
 * it touches no DOM and registers no listeners.
 *
 * That matters. This helper first lived in listening-tests-list.js, but that
 * module reads `#lt-grid` / `#state-*` at import time and registers its own
 * DOMContentLoaded handler — and listening-mini-test.html uses the SAME element
 * ids. Importing it from the mini page would have run the full-test loader too
 * and overwritten the mini list with Cambridge full tests.
 *
 * Why page at all: the Listening landing badges report the whole published
 * count, so a list that fetched one fixed-size page would promise sixty and
 * render fifty as soon as a library outgrew a single page.
 */

const PAGE_LIMIT = 100;      // the list endpoint caps `limit` at 100
const MAX_PAGES = 20;        // runaway guard; 2000 rows is far beyond any library

export async function fetchAllPages(buildPath, get) {
  const all = [];
  let offset = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await get(buildPath(PAGE_LIMIT, offset));
    const items = Array.isArray(res && res.items) ? res.items : [];
    all.push(...items);
    if (items.length < PAGE_LIMIT) break;
    offset += PAGE_LIMIT;
  }
  return all;
}

export function fetchAllTests(testType, get) {
  return fetchAllPages(
    (limit, offset) =>
      `/api/listening/tests?test_type=${testType}&limit=${limit}&offset=${offset}`,
    get,
  );
}

export { PAGE_LIMIT };
