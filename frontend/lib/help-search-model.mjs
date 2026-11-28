// Search for the /help page (LEARNERCORE-0063 FR-062): case- and
// accent-insensitive, over the question and the answer.

/**
 * Folds Vietnamese text for comparison: NFD, combining marks removed,
 * `đ`/`Đ` → `d`, lower case, runs of spaces collapsed.
 * @param {unknown} value @returns {string}
 */
export function foldVietnamese(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The groups with only the items that match `query`. An empty query keeps
 * every group whole; groups left without items are dropped.
 * @template {{ q: string, a: string }} I
 * @template {{ items: readonly I[] }} G
 * @param {readonly G[]} groups @param {unknown} query
 * @returns {{ groups: (G & { items: I[] })[], hits: number, searching: boolean }}
 */
export function filterHelp(groups, query) {
  const needle = foldVietnamese(query);
  let hits = 0;
  const kept = [];
  for (const group of groups) {
    const items = needle
      ? group.items.filter((item) => foldVietnamese(`${item.q} ${item.a}`).includes(needle))
      : [...group.items];
    hits += items.length;
    if (items.length) kept.push({ ...group, items });
  }
  return { groups: kept, hits, searching: Boolean(needle) };
}
