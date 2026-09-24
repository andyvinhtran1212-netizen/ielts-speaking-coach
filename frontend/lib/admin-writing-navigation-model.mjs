const LANES = new Set(['grading', 'graded', 'reviewed', 'delivered', 'all', 'mock']);
const STATUSES = new Set(['pending', 'grading', 'graded', 'reviewed', 'delivered', 'failed']);
const INSTRUCTOR_VIEWS = new Set(['all_active', 'queued', 'my_claims', 'delivered']);
const text = (value) => typeof value === 'string' ? value.trim() : '';
const flag = (value) => value === true || value === '1';
const field = (raw, ...names) => {
  for (const name of names) {
    const value = typeof raw?.get === 'function' ? raw.get(name) : raw?.[name];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
};
const pageNumber = (value) => {
  const source = String(value ?? '');
  return /^\d+$/.test(source) ? Math.min(100000, Math.max(1, Number(source))) : 1;
};

export function normalizeWritingQueueContext(raw = {}) {
  const mock = flag(field(raw, 'mocklane')) || field(raw, 'lane') === 'mock';
  const requested = text(field(raw, 'lane', 'status'));
  const hasStatus = field(raw, 'lane', 'status') !== undefined;
  let lane = mock ? 'mock' : hasStatus && (requested === '' || requested === 'all') ? 'all' : requested || 'graded';
  if (!LANES.has(lane)) lane = 'graded';
  const requestedStatus = text(field(raw, 'queueStatus', 'queue_status'));
  return {
    lane,
    page: pageNumber(field(raw, 'page')),
    pageSize: String(field(raw, 'pageSize', 'page_size')) === '50' ? 50 : 25,
    cohortId: text(field(raw, 'cohortId', 'cohort_id')).slice(0, 128),
    overdue: flag(field(raw, 'overdue')),
    embed: flag(field(raw, 'embed')),
    queueStatus: lane === 'mock' && STATUSES.has(requestedStatus) ? requestedStatus : '',
    query: text(field(raw, 'query', 'q')).slice(0, 100),
  };
}

export function writingQueueSearch(raw = {}) {
  const context = normalizeWritingQueueContext(raw);
  const params = new URLSearchParams();
  if (context.lane === 'mock') params.set('mocklane', '1');
  else if (context.lane !== 'graded') params.set('status', context.lane);
  if (context.cohortId) params.set('cohort_id', context.cohortId);
  if (context.overdue) params.set('overdue', '1');
  if (context.embed) params.set('embed', '1');
  if (context.queueStatus) params.set('queue_status', context.queueStatus);
  if (context.query) params.set('q', context.query);
  if (context.page > 1) params.set('page', String(context.page));
  if (context.pageSize !== 25) params.set('page_size', String(context.pageSize));
  return params.toString();
}

export function normalizeWritingNavigation(raw = {}) {
  const requestedSource = text(field(raw, 'from', 'source'));
  const source = requestedSource === 'queue' || requestedSource === 'instructor' ? requestedSource : 'direct';
  const requestedView = text(field(raw, 'view', 'instructorView'));
  return {
    source,
    essayId: text(field(raw, 'essayId', 'essay_id', 'id')),
    queue: normalizeWritingQueueContext(raw?.queue || raw),
    instructorView: INSTRUCTOR_VIEWS.has(requestedView) ? requestedView : 'all_active',
    embed: flag(field(raw, 'embed')),
    mocklane: flag(field(raw, 'mocklane')),
  };
}

export function writingNavigationHref(kind, raw = {}) {
  const context = normalizeWritingNavigation(raw);
  if (kind === 'workspace') return '/admin/writing';
  if (kind === 'queue') {
    if (context.source === 'instructor') {
      const params = new URLSearchParams();
      if (context.instructorView !== 'all_active') params.set('view', context.instructorView);
      if (context.embed) params.set('embed', '1');
      if (context.mocklane) params.set('mocklane', '1');
      return `/admin/writing/instructor-queue${params.size ? `?${params}` : ''}`;
    }
    if (context.source !== 'queue') return '/admin/writing/queue?status=grading';
    const search = writingQueueSearch(context.queue);
    return `/admin/writing/queue${search ? `?${search}` : ''}`;
  }
  if ((kind !== 'status' && kind !== 'grade') || !context.essayId) return '/admin/writing';
  const params = new URLSearchParams({ essay_id: context.essayId });
  if (context.source === 'queue') {
    params.set('from', 'queue');
    const search = writingQueueSearch(context.queue);
    for (const [key, value] of new URLSearchParams(search)) params.set(key, value);
  } else if (context.source === 'instructor') {
    params.set('from', 'instructor');
    if (context.instructorView !== 'all_active') params.set('view', context.instructorView);
    if (context.embed) params.set('embed', '1');
    if (context.mocklane) params.set('mocklane', '1');
  } else {
    if (context.embed) params.set('embed', '1');
    if (context.mocklane) params.set('mocklane', '1');
  }
  return `/admin/writing/${kind}?${params}`;
}
