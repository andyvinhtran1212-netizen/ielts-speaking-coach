const TASKS = new Set(['task_1', 'task_2', 'both']);
const CONTENT_TYPES = new Set(['tip', 'knowledge', 'sample', 'outline']);
const objectOf = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : null;
const textOf = (value) => typeof value === 'string' ? value.trim() : '';
const optionalText = (value) => textOf(value) || null;
const dateOf = (value) => { const text = optionalText(value); return text && !Number.isNaN(Date.parse(text)) ? text : null; };
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : objectOf(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)])) : value;
const stableJson = (value) => JSON.stringify(canonical(value));

export function normalizeWritingTip(raw) {
  const row = objectOf(raw); const id = textOf(row?.id); const title = textOf(row?.title); const slug = textOf(row?.slug);
  const bodyMarkdown = textOf(row?.body_markdown); const taskType = textOf(row?.task_type); const contentType = textOf(row?.content_type || 'tip');
  const displayOrder = Number(row?.display_order); const createdAt = dateOf(row?.created_at); const updatedAt = dateOf(row?.updated_at);
  if (!row || !id || title.length < 2 || !slug || !bodyMarkdown || !TASKS.has(taskType) || !CONTENT_TYPES.has(contentType) || typeof row.published !== 'boolean' || !Number.isInteger(displayOrder) || displayOrder < 0 || !createdAt || !updatedAt) return null;
  return { id, title, slug, bodyMarkdown, taskType, contentType, category: optionalText(row.category), published: row.published, displayOrder, typeData: objectOf(row.type_data) || {}, createdAt, updatedAt };
}

export function normalizeWritingTips(raw) {
  const payload = objectOf(raw); if (!Array.isArray(payload?.tips)) return null;
  const rows = []; const seen = new Set();
  for (const value of payload.tips) { const row = normalizeWritingTip(value); if (row && !seen.has(row.id)) { rows.push(row); seen.add(row.id); } }
  return { rows, malformedCount: payload.tips.length - rows.length, capped: payload.tips.length >= 500 };
}

export function writingTipsFilters(raw = {}) {
  const taskType = textOf(raw.task_type ?? raw.taskType); const published = textOf(raw.published); const q = textOf(raw.q);
  return { taskType: TASKS.has(taskType) ? taskType : '', published: ['true', 'false'].includes(published) ? published : '', q };
}

export function writingTipsHref(raw = {}) {
  const filters = writingTipsFilters(raw); const params = new URLSearchParams();
  if (filters.taskType) params.set('task_type', filters.taskType); if (filters.published) params.set('published', filters.published); if (filters.q) params.set('q', filters.q);
  const query = params.toString(); return `/admin/writing/tips${query ? `?${query}` : ''}`;
}

export function writingTipsPath(raw = {}, unfiltered = false) {
  const filters = writingTipsFilters(raw); const params = new URLSearchParams({ limit: '500' });
  if (!unfiltered && filters.taskType) params.set('task_type', filters.taskType); if (!unfiltered && filters.published) params.set('published', filters.published);
  return `/admin/writing/tips?${params}`;
}

export function writingTipSlugPath(slug) {
  const params = new URLSearchParams({ slug: textOf(slug), limit: '2' });
  return `/admin/writing/tips?${params}`;
}

export function writingTipMatches(row, filters) {
  const q = textOf(filters?.q).toLocaleLowerCase('vi');
  return !q || [row?.title, row?.slug, row?.category, row?.bodyMarkdown].some((value) => textOf(value).toLocaleLowerCase('vi').includes(q));
}

export function slugifyWritingTip(value) {
  return textOf(value).toLocaleLowerCase('vi').replaceAll('đ', 'd').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'tip';
}

export function normalizeTipDelete(raw, id) {
  const row = objectOf(raw); return row && textOf(row.tip_id) === textOf(id) && textOf(row.message) ? { id: textOf(id) } : null;
}

export function normalizeTipImport(raw) {
  const row = objectOf(raw); const parsed = objectOf(row?.parsed_data); const errors = Array.isArray(row?.validation_errors) ? row.validation_errors.map((value) => objectOf(value)).filter(Boolean).map((value) => ({ field: textOf(value.field) || 'file', message: textOf(value.message) || 'Lỗi không xác định' })) : null;
  if (!row || !errors || typeof row.dry_run !== 'boolean') return null;
  const preview = parsed ? { contentType: textOf(parsed.content_type), title: textOf(parsed.title), slug: textOf(parsed.slug), taskType: textOf(parsed.task_type), category: optionalText(parsed.category), published: Boolean(parsed.published), displayOrder: Number(parsed.display_order) || 0, typeData: objectOf(parsed.type_data) || {}, bodyMarkdown: textOf(parsed.body_markdown) } : null;
  const committedId = optionalText(row.committed_id); const action = optionalText(row.action);
  if (!row.dry_run && !errors.length && (!committedId || !['created', 'updated'].includes(action))) return null;
  return { preview, errors, dryRun: row.dry_run, committedId, action };
}

export function pendingTipOperation(raw, account) {
  const row = objectOf(raw); const owner = textOf(row?.account); const action = textOf(row?.action); const expected = objectOf(row?.expected);
  if (owner !== textOf(account) || !['create', 'update', 'publish', 'delete', 'import'].includes(action) || !expected) return null;
  const id = optionalText(row.id); const slug = textOf(expected.slug); const title = textOf(expected.title); const bodyMarkdown = textOf(expected.bodyMarkdown); const taskType = textOf(expected.taskType); const contentType = textOf(expected.contentType); const category = optionalText(expected.category); const displayOrder = Number(expected.displayOrder); const typeData = objectOf(expected.typeData);
  if (!slug || !title || !bodyMarkdown || !TASKS.has(taskType) || !CONTENT_TYPES.has(contentType) || typeof expected.published !== 'boolean' || !Number.isInteger(displayOrder) || displayOrder < 0 || !typeData || (['update', 'publish', 'delete'].includes(action) && !id)) return null;
  return { account: owner, action, id, expected: { slug, title, published: expected.published, bodyMarkdown, taskType, contentType, category, displayOrder, typeData }, startedAt: dateOf(row.startedAt) || new Date(0).toISOString() };
}

export function tipOperationMatches(operation, tip) {
  if (!operation || !tip) return false; if (operation.id && tip.id !== operation.id) return false;
  const expected = operation.expected; return tip.slug === expected.slug && tip.title === expected.title && tip.published === expected.published && tip.bodyMarkdown === expected.bodyMarkdown && tip.taskType === expected.taskType && tip.contentType === expected.contentType && tip.category === expected.category && tip.displayOrder === expected.displayOrder && stableJson(tip.typeData) === stableJson(expected.typeData);
}
