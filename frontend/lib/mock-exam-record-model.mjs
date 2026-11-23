// Trang một kỳ thi (MOCKORG-0086 T034 PR 1: FR-145, FR-146, FR-149, FR-151;
// sheet AdminKyThiChiTiet). Pure functions over `GET /admin/mock-exams/{id}/live`,
// `/roster`, `/audience` and `/events`. The page draws only what these return
// and reads them again after every write; nothing here guesses a state.

import { SKILL_NAMES, STATE_LABELS } from './mock-exam-org-model.mjs';

/** FR-145: one route, seven tabs, in this order. */
export const RECORD_TABS = Object.freeze([
  { id: 'de', label: 'Đề' },
  { id: 'thi-sinh', label: 'Thí sinh' },
  { id: 'theo-doi', label: 'Theo dõi' },
  { id: 'cham', label: 'Chấm' },
  { id: 'phan-tich', label: 'Phân tích' },
  { id: 'tra-ket-qua', label: 'Trả kết quả' },
  { id: 'nhat-ky', label: 'Nhật ký' },
]);
const TAB_IDS = new Set(RECORD_TABS.map((t) => t.id));

/** FR-145 default tab by state; states the spec does not name open on Đề. */
const DEFAULT_TAB = {
  draft: 'de', scheduled: 'de', open: 'theo-doi', running: 'theo-doi',
  grading: 'cham', released: 'phan-tich', ended: 'de', archived: 'de',
};

export function recordTab(param, state) {
  if (typeof param === 'string' && TAB_IDS.has(param)) return param;
  return DEFAULT_TAB[state] || 'de';
}

export function recordHref(examId, tab) {
  return `/admin/mock-tests/${encodeURIComponent(examId)}?tab=${encodeURIComponent(tab)}`;
}

export function stateLabelOf(state) {
  return state ? STATE_LABELS[state] || 'Chưa xác định' : 'Chưa xác định';
}

const TIMED = ['listening', 'reading', 'writing'];
const SECTION_STATES = new Set(['absent', 'waiting', 'working', 'submitted', 'missed']);
const SELF_PACED_STATES = new Set(['not_started', 'in_progress', 'submitted', 'missed']);
const ACTIVE = new Set(['not_started', 'listening', 'reading', 'writing', 'done']);

export const SECTION_NAMES = Object.freeze({
  not_started: 'Chưa bắt đầu', listening: 'Listening', reading: 'Reading', writing: 'Writing', done: 'Đã xong',
});

/** FR-151: exactly four states for a self-paced learner. */
export const SELF_PACED_LABELS = Object.freeze({
  not_started: 'Chưa bắt đầu',
  in_progress: 'Đang làm',
  submitted: 'Đã nộp',
  missed: 'Không dự thi',
});

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function count(value) {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

function modeOf(exam) {
  const v2 = text(exam?.exam_mode_v2);
  if (v2 === 'live' || v2 === 'self_paced') return v2;
  return text(exam?.exam_mode) === 'retake' ? 'self_paced' : 'live';
}

function section(raw) {
  if (!raw || typeof raw !== 'object' || !SECTION_STATES.has(raw.state)) return null;
  return {
    state: raw.state,
    answered: count(raw.answered),
    total: count(raw.total),
    submittedAt: text(raw.submitted_at),
    lastActivityAt: text(raw.last_activity_at),
    live: raw.live !== false,
    stalled: raw.stalled === true,
  };
}

/**
 * The self-paced state of one learner: the server's FR-151 field when it sent
 * one (flag on), else derived from the persisted sections the same way.
 */
function selfPacedState(raw, sections, windowClosed) {
  if (SELF_PACED_STATES.has(raw.self_paced_state)) return raw.self_paced_state;
  const list = Object.values(sections);
  if (!raw.sitting_id) return windowClosed ? 'missed' : 'not_started';
  if (list.length && list.every((s) => s.state === 'submitted' || s.state === 'missed')) return 'submitted';
  return 'in_progress';
}

/** `GET .../live` → the monitor model, or null outside the contract. */
export function normalizeMonitor(value, now = Date.now()) {
  if (!value || typeof value !== 'object' || !value.exam || !Array.isArray(value.students)) return null;
  const exam = value.exam;
  const id = text(exam.id);
  if (!id) return null;
  const mode = modeOf(exam);
  const configured = Array.isArray(exam.configured_sections)
    ? exam.configured_sections.filter((s) => TIMED.includes(s)) : [];
  const students = [];
  for (const raw of value.students) {
    if (!raw || typeof raw !== 'object') continue;
    const sections = {};
    for (const [key, item] of Object.entries(raw.sections || {})) {
      const normalized = TIMED.includes(key) ? section(item) : null;
      if (normalized) sections[key] = normalized;
    }
    const current = TIMED.includes(raw.current_section) ? raw.current_section : null;
    students.push({
      key: text(raw.sitting_id) || text(raw.user_id) || `${students.length}:${text(raw.student_name) || ''}`,
      userId: text(raw.user_id),
      sittingId: text(raw.sitting_id),
      name: text(raw.student_name) || 'Chưa có tên',
      started: raw.started === true,
      inRoster: raw.in_roster !== false,
      status: text(raw.status),
      skills: Array.isArray(raw.assigned_skills) ? raw.assigned_skills.filter((s) => SKILL_NAMES[s]) : null,
      sections,
      needsRetest: raw.needs_retest === true,
      selfPaced: mode === 'self_paced' ? {
        state: selfPacedState(raw, sections, false),
        currentSection: current,
        timeLeftSeconds: count(raw.section_time_left_seconds),
        expectedEndAt: text(raw.expected_end_at),
        fromServer: SELF_PACED_STATES.has(raw.self_paced_state),
      } : null,
    });
  }
  return {
    exam: {
      id,
      code: text(exam.code),
      title: text(exam.title) || 'Kỳ thi chưa có tên',
      mode,
      isOpen: exam.is_open === true,
      activeSection: ACTIVE.has(exam.active_section) ? exam.active_section : 'not_started',
      collectedSection: text(exam.collected_section),
      sweepDoneSection: text(exam.collection_sweep_completed_section),
      timeLeftSeconds: count(exam.section_time_left_seconds),
      configured,
      rosterSource: text(exam.roster_source),
    },
    idleMinutes: count(value.idle_threshold_minutes),
    students,
    serverTime: text(value.server_time),
    readAt: now,
  };
}

/** The part a live learner is on now, if the room has one running. */
function liveSection(monitor) {
  const active = monitor.exam.activeSection;
  return TIMED.includes(active) ? active : null;
}

/**
 * FR-146 alert strip, three kinds: lost connection, idle past the threshold
 * (Cài đặt `exam_idle_minutes`; the server's 5-minute mark when unknown), and
 * not in after the start.
 */
export function liveAlerts(monitor, now = Date.now()) {
  const out = { offline: [], idle: [], absent: [] };
  if (!monitor || monitor.exam.mode !== 'live') return out;
  const active = liveSection(monitor);
  const limit = monitor.idleMinutes;
  for (const student of monitor.students) {
    if (!student.inRoster && !student.started) continue;
    if (!student.started) {
      if (monitor.exam.activeSection !== 'not_started') out.absent.push(student.name);
      continue;
    }
    const current = active ? student.sections[active] : null;
    if (!current || current.state !== 'working') continue;
    if (!current.live) { out.offline.push(student.name); continue; }
    const last = current.lastActivityAt ? Date.parse(current.lastActivityAt) : NaN;
    const idle = limit != null
      ? Number.isFinite(last) && now - last > limit * 60_000
      : current.stalled;
    if (idle) out.idle.push(student.name);
  }
  return out;
}

/**
 * FR-146 proctor bar. "Thu bài và sang phần sau…" always asks first; after a
 * collect has finished, "Bắt đầu phần" turns on. `stale` locks everything
 * except closing the room.
 */
export function proctorState(monitor, stale) {
  const exam = monitor.exam;
  const order = exam.configured;
  const active = exam.activeSection;
  const next = active === 'not_started' ? order[0] || null
    : order.includes(active) ? order[order.indexOf(active) + 1] || null : null;
  const running = TIMED.includes(active);
  const paused = running && exam.collectedSection === active;
  const collecting = paused && exam.sweepDoneSection !== active;
  const readyToStart = active === 'not_started' || (paused && !collecting);
  return {
    next,
    paused,
    collecting,
    open: { enabled: !stale, label: exam.isOpen ? 'Đóng phòng' : 'Mở phòng' },
    start: { enabled: !stale && exam.isOpen && Boolean(next) && readyToStart, label: next ? `Bắt đầu phần ${SECTION_NAMES[next]}` : 'Bắt đầu phần' },
    collect: { enabled: !stale && running && !paused, label: 'Thu bài và sang phần sau…' },
  };
}

/** n/total, or "—". */
export function answeredCopy(sectionState) {
  if (!sectionState || sectionState.answered == null) return '—';
  return sectionState.total ? `${sectionState.answered}/${sectionState.total}` : String(sectionState.answered);
}

export function clockCopy(seconds) {
  if (seconds == null) return '—';
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

export function timeCopy(iso) {
  if (!iso) return '—';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '—';
  return at.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' });
}

/** FR-151 counts for the self-paced table head. */
export function selfPacedCounts(monitor) {
  const out = { not_started: 0, in_progress: 0, submitted: 0, missed: 0 };
  for (const s of monitor?.students || []) if (s.selfPaced) out[s.selfPaced.state] += 1;
  return out;
}

/** "Cộng giờ…" only for someone working, on the part running now (FR-151). */
export function canAddTime(student) {
  return Boolean(student?.selfPaced && student.selfPaced.state === 'in_progress' && student.selfPaced.currentSection);
}

// ── Thí sinh (FR-149) ───────────────────────────────────────────────────────

/** `GET .../roster` rows → by sitting id: the retest flags and the boxes allowed. */
export function normalizeRoster(value) {
  const rows = Array.isArray(value?.roster) ? value.roster : null;
  if (!rows) return null;
  const out = new Map();
  for (const row of rows) {
    const sittingId = text(row?.sitting_id);
    if (!sittingId) continue;
    out.set(sittingId, {
      reviewId: text(row.review_id),
      flags: Object.keys(row.retest_flags || {}).filter((k) => row.retest_flags[k] === true && SKILL_NAMES[k]),
      allowed: Array.isArray(row.retest_skills) ? row.retest_skills.filter((k) => SKILL_NAMES[k]) : [],
      sittingStatus: text(row.sitting_status),
    });
  }
  return out;
}

/** One line per learner: the monitor row, its audience source and retest flags. */
export function candidateRows(monitor, audienceItems, roster) {
  const byUser = new Map((audienceItems || []).filter((i) => i.userId).map((i) => [i.userId, i]));
  return (monitor?.students || []).map((s) => {
    const audience = s.userId ? byUser.get(s.userId) : null;
    const review = s.sittingId && roster ? roster.get(s.sittingId) || null : null;
    return {
      key: s.key,
      name: s.name,
      userId: s.userId,
      sittingId: s.sittingId,
      source: audience ? audience.source : s.inRoster ? '—' : 'Ngoài danh sách',
      skills: s.skills || audience?.skills || null,
      started: s.started,
      status: s.status,
      retestFlags: review ? review.flags : [],
      retestAllowed: review ? review.allowed : [],
      canFlag: Boolean(review && review.allowed.length),
    };
  });
}

/** POST body of `retest-flags`: every allowed box, true only for the ticked ones. */
export function retestFlagsBody(allowed, ticked) {
  return { retest_flags: Object.fromEntries(allowed.map((s) => [s, ticked.includes(s)])) };
}

/** Exams that can carry a make-up for this one: published, self-paced, not itself. */
export function makeupTargets(rows, examId) {
  return (rows || []).filter((r) => r.id !== examId && r.status === 'published' && r.mode === 'self_paced');
}

// ── Nhật ký ─────────────────────────────────────────────────────────────────

export const EVENT_LABELS = Object.freeze({
  room_opened: 'Mở phòng',
  room_closed: 'Đóng phòng',
  section_started: 'Bắt đầu phần',
  section_collected: 'Thu bài',
  audience_added: 'Thêm người thi',
  window_changed: 'Đổi khoảng mở',
  extra_time: 'Cộng giờ',
  room_message: 'Nhắn phòng',
  released: 'Trả kết quả',
  release_summary: 'Tóm tắt lần trả',
  score_edited: 'Sửa điểm sau khi trả',
  makeup_granted: 'Cho thi bù',
});

function payloadLine(kind, payload) {
  if (!payload || typeof payload !== 'object') return '';
  const bits = [];
  if (payload.section && SECTION_NAMES[payload.section]) bits.push(SECTION_NAMES[payload.section]);
  if (payload.skill && SKILL_NAMES[payload.skill]) bits.push(SKILL_NAMES[payload.skill]);
  if (Number.isFinite(payload.seconds)) bits.push(`+${Math.round(payload.seconds / 60)} phút`);
  if (Number.isFinite(payload.count)) bits.push(`${payload.count} người`);
  if (typeof payload.reason === 'string' && payload.reason.trim()) bits.push(`lý do: ${payload.reason.trim()}`);
  if (kind === 'room_message' && typeof payload.body === 'string') bits.push(`"${payload.body.trim()}"`);
  return bits.join(' · ');
}

/** `GET .../events` → rows for the Nhật ký table, newest first as sent. */
export function normalizeEvents(value) {
  if (!value || !Array.isArray(value.items)) return null;
  return value.items.filter((r) => r && text(r.id)).map((r) => ({
    id: text(r.id),
    kind: text(r.kind),
    label: EVENT_LABELS[r.kind] || text(r.kind) || 'Sự kiện',
    at: text(r.created_at),
    actor: text(r.actor_name) || (r.actor_id ? 'Người quản trị' : 'Hệ thống'),
    detail: payloadLine(r.kind, r.payload),
  }));
}

export function dateTimeCopy(iso) {
  if (!iso) return '—';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '—';
  return at.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Ho_Chi_Minh' });
}
