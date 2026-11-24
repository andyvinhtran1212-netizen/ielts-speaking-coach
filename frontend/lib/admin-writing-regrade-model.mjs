const STATUSES = new Set(['pending', 'accepted', 'rejected', 'fulfilled']);
// FR-062 lanes: Mới → (Đang chấm lại) → Đã trả lời. "Đang xem" needs a soft
// lock column that does not exist yet (GOI-09 G09-T39), so it is not a lane.
const LANE_OF = { pending: 'new', accepted: 'regrading', rejected: 'answered', fulfilled: 'answered' };
const LANES = new Set(['new', 'regrading', 'answered']);
export const KEEP_MIN_CHARS = 40;
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
  const hours = Number.isInteger(data.regrade_hours) && data.regrade_hours > 0 ? data.regrade_hours : null;
  // An older backend sends neither field: say the threshold is unknown rather
  // than marking nothing overdue.
  const thresholdsFailed = data.thresholds_failed === true || hours === null;
  return { rows, capped, malformedCount, regradeHours: hours, thresholdsFailed };
}

export function normalizeRegradeDecision(raw, expectedId, expectedStatus) {
  const row = normalizeRegradeRequest(raw);
  return row && row.id === expectedId && row.status === expectedStatus ? row : null;
}

export function regradeLane(status) {
  return LANE_OF[status] || null;
}

export function regradeFilters(raw) {
  const status = stringOf(raw?.status);
  // Old links (?status=pending|accepted|rejected|fulfilled) keep working.
  const lane = LANES.has(status) ? status : (LANE_OF[status] || 'new');
  return { status: lane, q: stringOf(raw?.q).slice(0, 120) };
}

/** Hours since the learner sent the request, and whether that passed the
 * ``regrade_hours`` threshold. Only open requests (Mới, Đang chấm lại) can be
 * overdue; an unknown threshold is never shown as "on time". */
export function regradeWait(row, nowMs, hours) {
  const sent = row?.createdAt ? Date.parse(row.createdAt) : Number.NaN;
  if (Number.isNaN(sent)) return null;
  const waited = Math.max(0, Math.floor((nowMs - sent) / 3_600_000));
  const open = row.status === 'pending' || row.status === 'accepted';
  return { hours: waited, open, overdue: !open ? false : hours != null ? waited >= hours : null };
}

export function waitLabel(waitedHours) {
  if (waitedHours < 1) return 'dưới 1 giờ';
  if (waitedHours < 48) return `${waitedHours} giờ`;
  return `${Math.floor(waitedHours / 24)} ngày`;
}

/** null when the "Giữ nguyên điểm" explanation can be sent, else why not. */
export function keepExplanationError(text) {
  const length = stringOf(text).length;
  if (!length) return 'Viết giải thích gửi học viên.';
  if (length < KEEP_MIN_CHARS) return `Giải thích cần ít nhất ${KEEP_MIN_CHARS} ký tự (đang có ${length}).`;
  return null;
}

export function regradeHref(filters) {
  const params = new URLSearchParams();
  const normalized = regradeFilters(filters);
  if (normalized.status !== 'new') params.set('status', normalized.status);
  if (normalized.q) params.set('q', normalized.q);
  const query = params.toString();
  return `/admin/writing/regrade-requests${query ? `?${query}` : ''}`;
}

export function regradeMatches(row, filters) {
  if (!row || regradeLane(row.status) !== filters.status) return false;
  const query = stringOf(filters.q).toLocaleLowerCase('vi');
  if (!query) return true;
  return `${row.studentName} ${row.studentCode || ''} ${row.cohortName || ''} ${row.essayPrompt || ''} ${row.reason}`
    .toLocaleLowerCase('vi').includes(query);
}

export function regradeSort(rows, status) {
  // Mới: longest wait first (the design's default); history newest first.
  const direction = status === 'new' || status === 'pending' ? 1 : -1;
  return [...rows].sort((left, right) => {
    const leftTime = left?.createdAt ? Date.parse(left.createdAt) : Number.NaN;
    const rightTime = right?.createdAt ? Date.parse(right.createdAt) : Number.NaN;
    if (Number.isNaN(leftTime)) return Number.isNaN(rightTime) ? 0 : 1;
    if (Number.isNaN(rightTime)) return -1;
    return direction * (leftTime - rightTime);
  });
}
