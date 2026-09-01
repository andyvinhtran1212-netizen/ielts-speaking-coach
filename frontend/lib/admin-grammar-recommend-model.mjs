function record(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : null; }
function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }

function candidate(value) {
  const row = record(value);
  const slug = text(row?.slug); const category = text(row?.category); const title = text(row?.title);
  const url = text(row?.url); const status = text(row?.status);
  const baseUrl = slug && category ? `/grammar/${encodeURIComponent(category)}/${encodeURIComponent(slug)}` : null;
  if (!slug || !category || !title || !url || !['complete', 'updating', 'draft'].includes(status)
      || typeof row.score !== 'number' || !Number.isFinite(row.score) || row.score < 0 || row.score > 1
      || (url !== baseUrl && !url.startsWith(`${baseUrl}#`))) return null;
  return { slug, category, title, url, status, score: row.score, summary: text(row.summary), anchor: text(row.anchor) };
}

export function normalizeGrammarRecommendPayload(value, expectedIssue) {
  const payload = record(value); const issue = text(payload?.issue); const outcome = text(payload?.outcome);
  if (!payload || issue !== expectedIssue || !['matched', 'below_threshold', 'draft_suppressed'].includes(outcome)) return null;
  const match = payload.match == null ? null : candidate(payload.match);
  const proposed = payload.candidate == null ? null : candidate(payload.candidate);
  if ((outcome === 'matched' && (!match || !proposed || match.url !== proposed.url || match.status === 'draft'))
      || (outcome === 'below_threshold' && (match || proposed))
      || (outcome === 'draft_suppressed' && (match || !proposed || proposed.status !== 'draft'))) return null;
  return { issue, outcome, match, candidate: proposed };
}

export function formatGrammarMatchScore(value) { return `${Math.round(value * 100)}%`; }
