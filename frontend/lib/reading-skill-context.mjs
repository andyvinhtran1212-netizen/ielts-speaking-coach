const skills = new Set(['skimming', 'scanning', 'detail', 'main_idea', 'inference', 'vocabulary_in_context', 'reference_cohesion', 'writer_view_TFNG']);
const field = (raw, key) => typeof raw?.getAll === 'function' ? (raw.getAll(key).length === 1 ? raw.get(key) : '') : raw?.[key];
export function readingSkillContext(raw = {}) {
  const difficulty = field(raw, 'difficulty'); const skill = field(raw, 'skill');
  const q = field(raw, 'q'); const batches = String(field(raw, 'batches') || '1');
  return { difficulty: ['foundation', 'intermediate', 'advanced'].includes(difficulty) ? difficulty : '',
    skill: skills.has(skill) ? skill : '', q: typeof q === 'string' && q.length <= 100 && !/[\u0000-\u001f\u007f]/.test(q) ? q.trim() : '',
    batches: /^[1-9]\d{0,2}$/.test(batches) ? Number(batches) : 1 };
}
export function readingSkillSearch(raw = {}) {
  const context = readingSkillContext(raw); const query = new URLSearchParams();
  for (const key of ['difficulty', 'skill', 'q']) if (context[key]) query.set(key, context[key]);
  if (context.batches > 1) query.set('batches', String(context.batches));
  return query.toString();
}
export function readingSkillHref(raw = {}) { const query = readingSkillSearch(raw); return `/reading/skill${query ? `?${query}` : ''}`; }
export function readingSkillArticleHref(slug, raw = {}) { const query = new URLSearchParams(readingSkillSearch(raw)); query.set('from', 'skill'); return `/reading/skill/${encodeURIComponent(slug)}?${query}`; }
export function readingSkillReturnHref(raw = {}) { return field(raw, 'from') === 'skill' ? readingSkillHref(raw) : '/reading/skill'; }
