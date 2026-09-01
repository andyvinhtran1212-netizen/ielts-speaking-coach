const STATUSES = new Set(['pending', 'accepted', 'rejected', 'fulfilled']);
const TASKS = new Set(['task1_academic', 'task1_general', 'task2']);
const objectOf = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : null;
const stringOf = (value) => typeof value === 'string' ? value.trim() : '';
const optionalString = (value) => stringOf(value) || null;
const validDate = (value) => {
  const text = optionalString(value);
  return text && !Number.isNaN(Date.parse(text)) ? text : null;
};

export function normalizeRegradeRequest(raw) {
  const row = objectOf(raw);
  if (!row) return null;
  const id = stringOf(row.id);
  const essayId = stringOf(row.essay_id);
  const status = stringOf(row.status);
  const reason = stringOf(row.reason);
  if (!id || !essayId || !STATUSES.has(status) || !reason) return null;
  const taskType = optionalString(row.essay_task_type);
  if (taskType && !TASKS.has(taskType)) return null;
  const band = row.essay_band == null ? null : Number(row.essay_band);
  if (band != null && (!Number.isFinite(band) || band < 0 || band > 9)) return null;
  return {
    id,
    essayId,
    status,
    reason,
    studentName: optionalString(row.student_name) || '—',
    studentCode: optionalString(row.student_code),
    cohortName: optionalString(row.cohort_name),
    taskType,
    essayPrompt: optionalString(row.essay_prompt),
    essayStatus: optionalString(row.essay_status),
    essayBand: band,
    adminResponse: optionalString(row.admin_response),
    createdAt: validDate(row.created_at),
    updatedAt: validDate(row.updated_at),
    actionedAt: validDate(row.actioned_at),
    fulfilledAt: validDate(row.fulfilled_at),
  };
}

export function normalizeRegradeList(raw) {
  const data = objectOf(raw);
  if (!data || !Array.isArray(data.requests)) return null;
  if (data.capped != null && typeof data.capped !== 'boolean') return null;
  const rows = [];
  let malformedCount = 0;
  for (const value of data.requests) {
    const row = normalizeRegradeRequest(value);
    if (row) rows.push(row); else malformedCount += 1;
  }
  if (new Set(rows.map((row) => row.id)).size !== rows.length) return null;
  // Backward-compatible during a staggered frontend/backend deploy: the old
  // endpoint returned no sentinel and capped at exactly 300. Treat 300 legacy
  // rows as potentially truncated; fewer rows are provably complete.
  const capped = typeof data.capped === 'boolean' ? data.capped : data.requests.length >= 300;
  return { rows, capped, malformedCount };
}

export function normalizeRegradeDecision(raw, expectedId, expectedStatus) {
  const row = normalizeRegradeRequest(raw);
  return row && row.id === expectedId && row.status === expectedStatus ? row : null;
}

export function regradeFilters(raw) {
  const status = stringOf(raw?.status);
  return {
    status: STATUSES.has(status) ? status : 'pending',
    q: stringOf(raw?.q).slice(0, 120),
  };
}

export function regradeHref(filters) {
  const params = new URLSearchParams();
  const normalized = regradeFilters(filters);
  if (normalized.status !== 'pending') params.set('status', normalized.status);
  if (normalized.q) params.set('q', normalized.q);
  const query = params.toString();
  return `/admin/writing/regrade-requests${query ? `?${query}` : ''}`;
}

export function regradeMatches(row, filters) {
  if (!row || row.status !== filters.status) return false;
  const query = stringOf(filters.q).toLocaleLowerCase('vi');
  if (!query) return true;
  return `${row.studentName} ${row.studentCode || ''} ${row.cohortName || ''} ${row.essayPrompt || ''} ${row.reason}`
    .toLocaleLowerCase('vi').includes(query);
}

export function regradeSort(rows, status) {
  const direction = status === 'pending' ? 1 : -1;
  return [...rows].sort((left, right) => {
    const leftTime = left?.createdAt ? Date.parse(left.createdAt) : Number.NaN;
    const rightTime = right?.createdAt ? Date.parse(right.createdAt) : Number.NaN;
    if (Number.isNaN(leftTime)) return Number.isNaN(rightTime) ? 0 : 1;
    if (Number.isNaN(rightTime)) return -1;
    return direction * (leftTime - rightTime);
  });
}
