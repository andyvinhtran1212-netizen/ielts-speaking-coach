const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const isString = (value) => typeof value === 'string';
const isNullableString = (value) => value == null || isString(value);
const isInteger = (value) => Number.isInteger(value);

export const REVIEW_TYPES = ['language', 'pedagogy', 'assessment'];
export const UNIT_STATUSES = ['', 'draft', 'published', 'archived'];

function normalizeGate(value) {
  if (!isObject(value) || !isObject(value.states)
    || !Array.isArray(value.pending_review_types)
    || typeof value.has_distinct_reviewers !== 'boolean'
    || typeof value.reviews_ready !== 'boolean') return null;
  const states = {};
  for (const type of REVIEW_TYPES) {
    const state = value.states[type];
    if (!['pending', 'approved', 'changes_requested'].includes(state)) return null;
    states[type] = state;
  }
  if (!value.pending_review_types.every((type) => REVIEW_TYPES.includes(type))) return null;
  return {
    states,
    pendingReviewTypes: [...value.pending_review_types],
    hasDistinctReviewers: value.has_distinct_reviewers,
    reviewsReady: value.reviews_ready,
  };
}

function normalizeVersionSummary(value) {
  if (!isObject(value) || !isString(value.id) || !isString(value.unit_id)
    || !isInteger(value.version_number) || !isString(value.status)
    || !isInteger(value.task_count) || !Array.isArray(value.dimensions)
    || !isInteger(value.review_count)) return null;
  const gate = normalizeGate(value.review_gate);
  if (!gate) return null;
  return {
    id: value.id,
    unitId: value.unit_id,
    versionNumber: value.version_number,
    status: value.status,
    changeNote: isNullableString(value.change_note) ? value.change_note ?? '' : '',
    authoredBy: isNullableString(value.authored_by) ? value.authored_by ?? '' : '',
    publishedAt: isNullableString(value.published_at) ? value.published_at ?? '' : '',
    updatedAt: isNullableString(value.updated_at) ? value.updated_at ?? '' : '',
    taskCount: value.task_count,
    dimensions: value.dimensions.filter(isString),
    reviewCount: value.review_count,
    reviewGate: gate,
  };
}

function normalizeUnit(value) {
  if (!isObject(value) || !isString(value.id) || !isString(value.unit_slug)
    || !isString(value.display_headword) || !isString(value.status)
    || !isString(value.target_level) || !Array.isArray(value.versions)) return null;
  const versions = value.versions.map(normalizeVersionSummary);
  if (versions.some((item) => !item)) return null;
  return {
    id: value.id,
    slug: value.unit_slug,
    displayHeadword: value.display_headword,
    unitType: isString(value.unit_type) ? value.unit_type : '',
    targetLevel: value.target_level,
    status: value.status,
    currentPublishedVersionId: isNullableString(value.current_published_version_id)
      ? value.current_published_version_id ?? '' : '',
    updatedAt: isNullableString(value.updated_at) ? value.updated_at ?? '' : '',
    versions,
  };
}

export function normalizeEditorialListPayload(value) {
  if (!isObject(value) || !Array.isArray(value.items)
    || !isInteger(value.total) || value.total < 0
    || !isInteger(value.offset) || value.offset < 0
    || !isInteger(value.limit) || value.limit < 1 || value.limit > 100) return null;
  const items = value.items.map(normalizeUnit);
  if (items.some((item) => !item)) return null;
  return { items, total: value.total, offset: value.offset, limit: value.limit };
}

function normalizeReview(value) {
  if (!isObject(value) || !isString(value.id) || !isString(value.version_id)
    || !REVIEW_TYPES.includes(value.review_type)
    || !['approved', 'changes_requested'].includes(value.decision)) return null;
  return {
    id: value.id,
    versionId: value.version_id,
    reviewerId: isNullableString(value.reviewer_id) ? value.reviewer_id ?? '' : '',
    reviewType: value.review_type,
    decision: value.decision,
    notes: isNullableString(value.notes) ? value.notes ?? '' : '',
    updatedAt: isNullableString(value.updated_at) ? value.updated_at ?? '' : '',
  };
}

function normalizeTask(value) {
  if (!isObject(value) || !isString(value.id) || !isString(value.version_id)
    || !isInteger(value.sequence) || !isString(value.task_type)
    || !isString(value.dimension) || !isString(value.prompt)
    || !Array.isArray(value.options) || !isObject(value.answer_key)
    || !isString(value.explanation_vi) || !isString(value.status)) return null;
  return {
    id: value.id,
    versionId: value.version_id,
    sequence: value.sequence,
    taskType: value.task_type,
    dimension: value.dimension,
    prompt: value.prompt,
    options: value.options,
    answerKey: value.answer_key,
    explanationVi: value.explanation_vi,
    status: value.status,
  };
}

function normalizeVersionDetail(value) {
  if (!isObject(value) || !isString(value.id) || !isInteger(value.version_number)
    || !isString(value.status) || !isObject(value.content)
    || !Array.isArray(value.sources) || !Array.isArray(value.tasks)
    || !Array.isArray(value.reviews)) return null;
  const tasks = value.tasks.map(normalizeTask);
  const reviews = value.reviews.map(normalizeReview);
  const gate = normalizeGate(value.review_gate);
  if (tasks.some((item) => !item) || reviews.some((item) => !item) || !gate) return null;
  return {
    id: value.id,
    versionNumber: value.version_number,
    status: value.status,
    content: value.content,
    sources: value.sources,
    changeNote: isNullableString(value.change_note) ? value.change_note ?? '' : '',
    authoredBy: isNullableString(value.authored_by) ? value.authored_by ?? '' : '',
    publishedAt: isNullableString(value.published_at) ? value.published_at ?? '' : '',
    updatedAt: isNullableString(value.updated_at) ? value.updated_at ?? '' : '',
    tasks,
    reviews,
    reviewGate: gate,
  };
}

export function normalizeEditorialDetail(value) {
  if (!isObject(value) || !isObject(value.unit)
    || !Array.isArray(value.versions) || !Array.isArray(value.events)
    || !isInteger(value.events_total) || value.events_total < value.events.length
    || typeof value.events_has_more !== 'boolean'
    || value.events_has_more !== (value.events_total > value.events.length)
    || !isString(value.unit.id) || !isString(value.unit.display_headword)
    || !isString(value.unit.unit_slug)) return null;
  const versions = value.versions.map(normalizeVersionDetail);
  if (versions.some((item) => !item) || value.events.some((item) => !isObject(item))) return null;
  return {
    unit: {
      ...value.unit,
      displayHeadword: value.unit.display_headword,
      slug: value.unit.unit_slug,
      currentPublishedVersionId: isNullableString(value.unit.current_published_version_id)
        ? value.unit.current_published_version_id ?? '' : '',
    },
    versions,
    events: value.events,
    eventsTotal: value.events_total,
    eventsHasMore: value.events_has_more,
  };
}

const stable = (value) => JSON.stringify(value ?? null, null, 2);

export function buildEditorialDiff(baseVersion, targetVersion) {
  if (!targetVersion) return [];
  const base = baseVersion || { content: {}, sources: [], tasks: [] };
  const entries = [];
  const contentKeys = [...new Set([
    ...Object.keys(base.content || {}), ...Object.keys(targetVersion.content || {}),
  ])].sort();
  for (const key of contentKeys) {
    const before = stable(base.content?.[key]);
    const after = stable(targetVersion.content?.[key]);
    if (before !== after) entries.push({ field: `content.${key}`, before, after });
  }
  const beforeSources = stable(base.sources || []);
  const afterSources = stable(targetVersion.sources || []);
  if (beforeSources !== afterSources) entries.push({ field: 'sources', before: beforeSources, after: afterSources });
  const taskShape = (task) => ({
    sequence: task.sequence, task_type: task.taskType, dimension: task.dimension,
    prompt: task.prompt, options: task.options, answer_key: task.answerKey,
    explanation_vi: task.explanationVi, status: task.status,
  });
  const beforeTasks = stable((base.tasks || []).map(taskShape));
  const afterTasks = stable((targetVersion.tasks || []).map(taskShape));
  if (beforeTasks !== afterTasks) entries.push({ field: 'tasks', before: beforeTasks, after: afterTasks });
  return entries;
}

export function editorialCatalogQuery({ status = '', offset = 0, limit = 100 } = {}) {
  if (!UNIT_STATUSES.includes(status) || !isInteger(offset) || offset < 0
    || !isInteger(limit) || limit < 1 || limit > 100) return null;
  const params = new URLSearchParams({ offset: String(offset), limit: String(limit) });
  if (status) params.set('status', status);
  return params.toString();
}

export function safeEditorialSourceHref(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname ? url.href : null;
  } catch {
    return null;
  }
}
