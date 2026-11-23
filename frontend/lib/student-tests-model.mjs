// Thi thử page model (LEARNERCORE-0063 amendment 1, FR-080…FR-084).
// Pure functions over `GET /api/student/tests` (#2603, models/student_tests.py);
// the `tests-hub-v2` component only draws what these return. Every word on the
// page comes from spec.md FR-081/FR-082 and ui-states.md.

const SKILLS = ['listening', 'reading', 'writing', 'speaking'];
const SKILL_NAMES = { listening: 'Listening', reading: 'Reading', writing: 'Writing', speaking: 'Speaking' };
const EXAM_STATES = new Set(['upcoming', 'open', 'submitted', 'released', 'closed_missed']);
const RESULT_KINDS = new Set([
  'listening_full', 'listening_mini', 'reading_full', 'reading_mini', 'speaking_full', 'writing_full', 'mock',
]);
const MOCK_STATES = new Set(['submitted', 'grading', 'reviewing', 'released']);
const DEGRADABLE = new Set(['assigned_exams', 'results', 'credits']);

/** FR-084: credits a full test needs (G04 units); other rows never check credits. */
export const FULL_TEST_CREDITS = Object.freeze({ writing: 2, speaking: 3 });

/**
 * FR-080 block 1, in this order: one full and one mini row per skill that has
 * that kind of test. `href` is the planned target; the component draws a row
 * only when `liveHref` resolves it. Speaking full is the full-test entry in
 * /speaking; Writing full is G08's page (hidden until it is live).
 */
export const SELF_TESTS = Object.freeze([
  { id: 'listening_full', skill: 'listening', full: true, title: 'Full test Listening', href: '/listening/tests' },
  { id: 'listening_mini', skill: 'listening', full: false, title: 'Mini test Listening', href: '/listening/mini-test' },
  { id: 'reading_full', skill: 'reading', full: true, title: 'Full test Reading', href: '/reading/test' },
  { id: 'reading_mini', skill: 'reading', full: false, title: 'Mini test Reading', href: '/reading/mini-test' },
  { id: 'speaking_full', skill: 'speaking', full: true, title: 'Full test Speaking', href: '/speaking' },
  { id: 'writing_full', skill: 'writing', full: true, title: 'Full test Writing', href: '/writing/full-test' },
]);

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function int(value) {
  return Number.isInteger(value) ? value : null;
}

function band(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 9 ? value : null;
}

/** Same-origin path only: an API href never sends the learner off the site. */
export function safePath(value) {
  const path = text(value);
  return path && path.startsWith('/') && !path.startsWith('//') && !path.includes('\\') ? path : null;
}

function skills(value) {
  if (!Array.isArray(value)) return null;
  const out = SKILLS.filter((skill) => value.includes(skill));
  return out.length ? out : null;
}

function examRow(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = text(raw.exam_id);
  const href = safePath(raw.href);
  if (!id || !href || !EXAM_STATES.has(raw.state)) return null;
  return {
    id,
    title: text(raw.title) || 'Mock test',
    mode: raw.mode === 'live' || raw.mode === 'self_paced' ? raw.mode : null,
    state: raw.state,
    opensAt: text(raw.opens_at),
    closesAt: text(raw.closes_at),
    skills: skills(raw.skills),
    totalMinutes: int(raw.total_minutes) !== null && raw.total_minutes > 0 ? raw.total_minutes : null,
    inProgress: raw.has_sitting_in_progress === true,
    href,
  };
}

function resultRow(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = text(raw.id);
  const href = safePath(raw.href);
  const submittedAt = text(raw.submitted_at);
  if (!id || !href || !submittedAt || !RESULT_KINDS.has(raw.kind)) return null;
  const mock = raw.kind === 'mock';
  const state = mock && MOCK_STATES.has(raw.state) ? raw.state : null;
  if (mock && !state) return null;
  const released = state === 'released';
  const correct = int(raw.correct);
  const total = int(raw.total);
  return {
    kind: raw.kind,
    id,
    title: text(raw.title) || resultKindLabel(raw.kind),
    submittedAt,
    state,
    // A mock row carries no band; an unreleased one carries no score at all (HOLD FR-082).
    band: mock ? null : band(raw.band),
    correct: !mock && total !== null && total > 0 && correct !== null && correct >= 0 ? correct : null,
    total: !mock && total !== null && total > 0 && correct !== null && correct >= 0 ? total : null,
    overall: released ? band(raw.overall) : null,
    pendingSkills: released ? skills(raw.pending_skills) : null,
    href,
  };
}

/** The page payload, or null when it is outside the contract. */
export function normalizeStudentTests(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!Array.isArray(value.assigned_exams) || !Array.isArray(value.results) || !Array.isArray(value.degraded)) return null;
  const total = int(value.credits?.total);
  return {
    assigned: value.assigned_exams.map(examRow).filter(Boolean),
    results: value.results.map(resultRow).filter(Boolean),
    nextCursor: text(value.results_next_cursor),
    credits: total !== null && total >= 0 ? { total } : null,
    degraded: new Set(value.degraded.filter((part) => DEGRADABLE.has(part))),
  };
}

/** FR-081: the state, in words; exactly one of five. */
export function examStateLabel(state) {
  return {
    upcoming: 'Sắp diễn ra',
    open: 'Đang mở',
    submitted: 'Đã thi, chờ kết quả',
    released: 'Đã có kết quả',
    closed_missed: 'Đã đóng, bạn chưa thi',
  }[state] || null;
}

/** FR-081: the mode line; null mode → no line. */
export function examModeLabel(mode) {
  if (mode === 'live') return 'Thi cùng giờ';
  if (mode === 'self_paced') return 'Bắt đầu lúc nào cũng được trong thời gian mở';
  return null;
}

/** FR-081: "Gồm: …" only for an exam without all four skills. */
export function examSkillsLine(list) {
  if (!list || list.length >= SKILLS.length) return null;
  return `Gồm: ${list.map((skill) => SKILL_NAMES[skill]).join(', ')}`;
}

/** FR-081: the back-to-back sentence of a self-paced exam; no N → no sentence (never summed here). */
export function examSelfPacedLine(exam) {
  if (exam.mode !== 'self_paced' || !exam.totalMinutes) return null;
  return `Làm liền một mạch khoảng ${exam.totalMinutes} phút. Đã bắt đầu thì không dừng giữa các phần.`;
}

/** FR-081: the one button of a row, or null. */
export function examAction(exam) {
  if (exam.state === 'open') return { label: exam.inProgress ? 'Làm tiếp' : 'Vào thi', href: exam.href, fullTest: true };
  if (exam.state === 'released') return { label: 'Xem kết quả', href: exam.href, fullTest: false };
  return null;
}

/** FR-082: the kind column. */
export function resultKindLabel(kind) {
  if (kind === 'mock') return 'Mock test';
  const [skill, size] = String(kind).split('_');
  if (!SKILL_NAMES[skill]) return null;
  return `${size === 'mini' ? 'Mini test' : 'Full test'} ${SKILL_NAMES[skill]}`;
}

function bandCopy(value) {
  return Number.isInteger(value) ? `${value}.0` : String(value);
}

/** FR-082 / FR-077: the result column; null means nothing to show. */
export function resultScoreCopy(row) {
  if (row.kind === 'mock') return row.state === 'released' ? null : 'Đang chờ công bố';
  if (row.kind.endsWith('_mini')) return row.total ? `Đúng ${row.correct} trên ${row.total} câu` : null;
  if (row.band !== null) return `Band ${bandCopy(row.band)}`;
  return row.kind === 'writing_full' || row.kind === 'speaking_full' ? 'Đang chấm' : null;
}

/** FR-082: the Overall cell; null → empty cell with the screen-reader label "Không có Overall". */
export function resultOverallCopy(row) {
  if (row.kind !== 'mock' || row.state !== 'released') return null;
  if (row.overall !== null) return bandCopy(row.overall);
  if (row.pendingSkills) return `Chưa có Overall: còn chờ chấm ${row.pendingSkills.map((s) => SKILL_NAMES[s]).join(', ')}`;
  return null;
}

/** FR-084: a Writing/Speaking full test the learner has too few credits for; null credits → never. */
export function shortOfCredits(test, credits) {
  const need = test.full ? FULL_TEST_CREDITS[test.skill] : undefined;
  return Boolean(need && credits && credits.total < need);
}

const VN_DATE = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric',
});
const VN_DATE_TIME = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
});

/** Vietnam date of a submit ("23/11/2026"); null when unreadable. */
export function vnDateCopy(value) {
  const ms = Date.parse(value || '');
  return Number.isFinite(ms) ? VN_DATE.format(ms) : null;
}

/** Vietnam date and time of an exam window ("20:00 25/11/2026"); null when unreadable. */
export function vnDateTimeCopy(value) {
  const ms = Date.parse(value || '');
  if (!Number.isFinite(ms)) return null;
  const parts = Object.fromEntries(VN_DATE_TIME.formatToParts(ms).map((p) => [p.type, p.value]));
  return `${parts.hour}:${parts.minute} ${parts.day}/${parts.month}/${parts.year}`;
}
