/** Presentation only. Flat numbered rows remain usable by older exam clients. */
export function noteTemplateTree(rows = []) {
  if (!Array.isArray(rows)) return [];
  if (!rows.some(row => Number.isInteger(row?.indent))) return rows;
  const roots = [];
  const parents = [];
  for (const row of rows) {
    const item = row && typeof row === 'object' ? { ...row } : { text: String(row ?? '') };
    const depth = Number.isInteger(row?.indent) && row.indent >= 0 && row.indent <= parents.length ? row.indent : 0;
    delete item.indent;
    const parent = depth ? parents[depth - 1] : null;
    if (parent) parent.items = [...(parent.items || []), item];
    else roots.push(item);
    parents[depth] = item;
    parents.length = depth + 1;
  }
  return roots;
}
