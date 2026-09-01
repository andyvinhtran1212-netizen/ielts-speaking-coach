const SAFE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function normalizeVocabContextLinks(payload) {
  const rows = payload && typeof payload === 'object' && Array.isArray(payload.links)
    ? payload.links
    : [];
  const links = [];
  const seen = new Set();
  for (const row of rows.slice(0, 30)) {
    if (!row || typeof row !== 'object' || !row.unit || typeof row.unit !== 'object') continue;
    const requestTerm = typeof row.request_term === 'string' ? row.request_term : '';
    const unitSlug = typeof row.unit.unit_slug === 'string' ? row.unit.unit_slug.trim() : '';
    const title = typeof row.unit.title_vi === 'string' && row.unit.title_vi.trim()
      ? row.unit.title_vi.trim()
      : typeof row.unit.display_headword === 'string' ? row.unit.display_headword.trim() : '';
    const rationale = typeof row.rationale_vi === 'string' ? row.rationale_vi.trim() : '';
    const level = typeof row.unit.target_level === 'string' ? row.unit.target_level.trim() : '';
    if (!requestTerm || requestTerm.length > 160 || seen.has(requestTerm) || !SAFE_SLUG.test(unitSlug) || !title || !rationale) continue;
    links.push({ requestTerm, unitSlug, title, rationale, level });
    seen.add(requestTerm);
  }
  return links;
}
