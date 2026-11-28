// Kỳ thi admin model (MOCKORG-0086 T032, FR-140…FR-144; sheet AdminKyThi).
// Pure functions over `GET /admin/mock-exams` (with `display_state`,
// `audience_count`), `GET|PATCH /admin/mock-exams/{id}/audience` and
// `POST /admin/mock-exams/{id}/schedule`. The list and the three-step setup
// only draw what these return; after every write the page reads the API again.

export const SKILLS = Object.freeze(['listening', 'reading', 'writing', 'speaking']);
export const SKILL_NAMES = Object.freeze({ listening: 'Listening', reading: 'Reading', writing: 'Writing', speaking: 'Speaking' });
const SKILL_LETTER = { listening: 'L', reading: 'R', writing: 'W', speaking: 'S' };
const STATES = new Set(['draft', 'scheduled', 'open', 'running', 'grading', 'released', 'ended', 'archived']);

export const STATE_LABELS = Object.freeze({
  draft: 'Nháp',
  scheduled: 'Đã lên lịch',
  open: 'Đang mở',
  running: 'Đang diễn ra',
  grading: 'Chờ chấm',
  released: 'Đã trả kết quả',
  ended: 'Đã kết thúc',
  archived: 'Lưu trữ',
});

/** FR-140 filter chips; "Đang diễn ra" also holds a self-paced exam that is open. */
export const LIST_FILTERS = Object.freeze([
  { id: 'all', label: 'Tất cả', states: null },
  { id: 'draft', label: 'Nháp', states: ['draft'] },
  { id: 'scheduled', label: 'Đã lên lịch', states: ['scheduled'] },
  { id: 'running', label: 'Đang diễn ra', states: ['running', 'open'] },
  { id: 'grading', label: 'Chờ chấm', states: ['grading'] },
  { id: 'released', label: 'Đã trả kết quả', states: ['released'] },
  { id: 'other', label: 'Đã kết thúc, lưu trữ', states: ['ended', 'archived'] },
]);

export const MODE_LABELS = Object.freeze({ live: 'Phòng thi cùng giờ', self_paced: 'Làm trong khoảng thời gian' });

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function int(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function skillList(value) {
  if (!Array.isArray(value)) return null;
  const out = SKILLS.filter((s) => value.includes(s));
  return out.length ? out : null;
}

function modeOf(raw) {
  const v2 = text(raw?.exam_mode_v2);
  if (v2 === 'live' || v2 === 'self_paced') return v2;
  const legacy = text(raw?.exam_mode);
  if (legacy === 'retake' || legacy === 'self_paced') return 'self_paced';
  return 'live';
}

/** One admin list row, or null when it is outside the contract. */
export function normalizeOrgExam(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = text(raw.id);
  const status = text(raw.status);
  if (!id || !['draft', 'published', 'archived'].includes(status)) return null;
  return {
    id,
    title: text(raw.title) || 'Kỳ thi chưa có tên',
    status,
    mode: modeOf(raw),
    // null = the sittings could not be read: the page says so instead of guessing.
    state: STATES.has(raw.display_state) ? raw.display_state : null,
    // null on an exam created before migration 445 = all four (plan 5.5).
    skills: skillList(raw.skills) || [...SKILLS],
    audienceCount: int(raw.audience_count),
    startsAt: text(raw.starts_at),
    openFrom: text(raw.open_from),
    openUntil: text(raw.open_until),
    createdAt: text(raw.created_at),
    listeningTestId: text(raw.listening_test_id),
    readingTestId: text(raw.reading_test_id),
    writingTask1PromptId: text(raw.writing_task1_prompt_id),
    writingTask2PromptId: text(raw.writing_task2_prompt_id),
    hasSpeakingPaper: Boolean(raw.speaking_topic_set && typeof raw.speaking_topic_set === 'object'
      && !Array.isArray(raw.speaking_topic_set) && Object.keys(raw.speaking_topic_set).length),
    // Listening seat clock from the server (audio + buffer); null = no paper or unread.
    listeningSeconds: int(raw.listening_seconds),
    readingMinutes: Number.isInteger(raw.reading_minutes) && raw.reading_minutes > 0 ? raw.reading_minutes : 60,
    writingMinutes: Number.isInteger(raw.writing_minutes) && raw.writing_minutes > 0 ? raw.writing_minutes : 60,
    allowEarlyAdvance: raw.allow_early_advance === true,
    draftStep: SETUP_STEP_IDS.includes(raw?.draft_state?.step) ? raw.draft_state.step : null,
  };
}

/** `GET /admin/mock-exams`, newest first; `malformed` counts rows left out. */
export function normalizeOrgExamList(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.exams)) return null;
  const rows = value.exams.map(normalizeOrgExam);
  return { rows: rows.filter(Boolean), malformed: rows.filter((r) => !r).length };
}

export function filterOrgExams(rows, filterId) {
  const filter = LIST_FILTERS.find((f) => f.id === filterId);
  if (!filter || !filter.states) return rows;
  return rows.filter((row) => row.state && filter.states.includes(row.state));
}

export function filterCounts(rows) {
  return Object.fromEntries(LIST_FILTERS.map((f) => [f.id, filterOrgExams(rows, f.id).length]));
}

export function stateLabel(state) {
  return state ? STATE_LABELS[state] : 'Chưa xác định';
}

export function skillLetters(skills) {
  return skills.map((s) => SKILL_LETTER[s]).join(' ');
}

const VN_DATE_TIME = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/** "20:00 25/11/2026" in Vietnam time; null when unreadable. */
export function vnDateTime(value) {
  const ms = Date.parse(value || '');
  if (!Number.isFinite(ms)) return null;
  const p = Object.fromEntries(VN_DATE_TIME.formatToParts(ms).map((x) => [x.type, x.value]));
  return `${p.hour}:${p.minute} ${p.day}/${p.month}/${p.year}`;
}

/** The "Ngày giờ" column. */
export function whenCopy(exam) {
  if (exam.mode === 'live') return vnDateTime(exam.startsAt) || 'Chưa có ngày giờ';
  const from = vnDateTime(exam.openFrom);
  const until = vnDateTime(exam.openUntil);
  if (from && until) return `${from} – ${until}`;
  if (until) return `Đến ${until}`;
  return 'Chưa có khoảng mở';
}

/** The "Người thi" column; null count (flag off or count failed) → "chưa có". */
export function audienceCopy(exam) {
  return exam.audienceCount === null ? 'Chưa có số người' : `${exam.audienceCount} người`;
}

/** The "Việc tiếp theo" column. */
export function nextStepCopy(exam) {
  switch (exam.state) {
    case 'draft': return 'Hoàn tất và lên lịch';
    case 'scheduled': return exam.mode === 'live' ? 'Chờ giờ mở phòng' : 'Chờ khoảng mở bắt đầu';
    case 'open': return 'Theo dõi người thi';
    case 'running': return 'Theo dõi phòng thi';
    case 'grading': return 'Chấm bài';
    case null: return 'Tải lại để xem trạng thái';
    default: return 'Không có';
  }
}

/**
 * Where the exam name goes. A draft opens its setup. The one-exam page
 * (G09-T34) is not live yet, so other exams open the current console scoped
 * to that exam: live tab while it runs, review tab after.
 */
export function examHref(exam) {
  if (exam.status === 'draft') return `/admin/mock-tests/${encodeURIComponent(exam.id)}/setup`;
  const tab = exam.state === 'grading' || exam.state === 'released' || exam.state === 'ended' ? 'review' : 'live';
  return `/admin/mock-tests?view=console&tab=${tab}&exam_id=${encodeURIComponent(exam.id)}`;
}

// ── Setup: Đề · Người thi · Cách thi · Xem lại (FR-141) ─────────────────────

export const SETUP_STEPS = Object.freeze([
  { id: 'papers', label: 'Đề' },
  { id: 'audience', label: 'Người thi' },
  { id: 'mode', label: 'Cách thi' },
  { id: 'review', label: 'Xem lại' },
]);
const SETUP_STEP_IDS = SETUP_STEPS.map((s) => s.id);

export function setupStep(value) {
  return SETUP_STEP_IDS.includes(value) ? value : 'papers';
}

/** The editable fields of an exam, as the form holds them (local VN time strings). */
export function formFromExam(exam) {
  return {
    title: exam?.title && exam.title !== 'Kỳ thi chưa có tên' ? exam.title : '',
    skills: exam ? [...exam.skills] : [...SKILLS],
    listeningTestId: exam?.listeningTestId || '',
    readingTestId: exam?.readingTestId || '',
    writingTask1PromptId: exam?.writingTask1PromptId || '',
    writingTask2PromptId: exam?.writingTask2PromptId || '',
    mode: exam?.mode || 'live',
    startsAt: isoToVnLocal(exam?.startsAt),
    openFrom: isoToVnLocal(exam?.openFrom),
    openUntil: isoToVnLocal(exam?.openUntil),
    allowEarlyAdvance: exam?.allowEarlyAdvance === true,
  };
}

const VN_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/** ISO instant → "2026-11-25T20:00" in Vietnam time (for datetime-local); '' when unreadable. */
export function isoToVnLocal(value) {
  const ms = Date.parse(value || '');
  if (!Number.isFinite(ms)) return '';
  const p = Object.fromEntries(VN_PARTS.formatToParts(ms).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** "2026-11-25T20:00" in Vietnam time → ISO with +07:00; null when unreadable. */
export function vnLocalToIso(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const iso = `${value}:00+07:00`;
  return Number.isFinite(Date.parse(iso)) ? iso : null;
}

/** Toggle one skill in the fixed order; may return none (saving refuses an empty list). */
export function toggleSkill(skills, skill) {
  const next = skills.includes(skill) ? skills.filter((s) => s !== skill) : [...skills, skill];
  return SKILLS.filter((s) => next.includes(s));
}

function examFields(form) {
  const has = (skill) => form.skills.includes(skill);
  return {
    title: form.title.trim(),
    skills: form.skills,
    exam_mode: form.mode,
    // A skill that is not sat carries no paper (FR-141: not all four required).
    listening_test_id: has('listening') ? form.listeningTestId || null : null,
    reading_test_id: has('reading') ? form.readingTestId || null : null,
    writing_task1_prompt_id: has('writing') ? form.writingTask1PromptId || null : null,
    writing_task2_prompt_id: has('writing') ? form.writingTask2PromptId || null : null,
    starts_at: form.mode === 'live' ? vnLocalToIso(form.startsAt) : null,
    open_from: form.mode === 'self_paced' ? vnLocalToIso(form.openFrom) : null,
    open_until: form.mode === 'self_paced' ? vnLocalToIso(form.openUntil) : null,
    allow_early_advance: form.mode === 'live' ? form.allowEarlyAdvance : false,
  };
}

/** A machine code the page never shows (plan: "mã kỳ thi dạng máy" stays off screen). */
export function newExamCode(now = Date.now(), random = Math.random) {
  const p = Object.fromEntries(VN_PARTS.formatToParts(now).map((x) => [x.type, x.value]));
  const tail = Math.floor(random() * 36 ** 4).toString(36).toUpperCase().padStart(4, '0');
  return `KT${p.year}${p.month}${p.day}-${tail}`;
}

/**
 * `POST /admin/mock-exams` for a new draft. Papers ride on the create so the
 * server makes its private copies (mig 315); null fields are left out.
 */
export function buildCreateBody(form, code, step = 'papers') {
  if (!form.title.trim()) return { ok: false, error: 'Nhập tên kỳ thi trước khi lưu nháp.' };
  if (!form.skills.length) return { ok: false, error: 'Chọn ít nhất một kỹ năng.' };
  const fields = examFields(form);
  const body = { code, private_content_copy: true, draft_state: { step } };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== null) body[key] = value;
  }
  if (body.listening_test_id) body.listening_is_public = false;
  if (body.reading_test_id) body.reading_is_public = false;
  return { ok: true, value: body };
}

/**
 * `PATCH /admin/mock-exams/{id}`: only fields that differ from the stored exam.
 * A cleared time is not sent (the PATCH model ignores null), so the page warns
 * instead of claiming it removed it.
 */
export function buildPatchBody(form, exam, step) {
  if (!form.title.trim()) return { ok: false, error: 'Tên kỳ thi không được để trống.' };
  if (!form.skills.length) return { ok: false, error: 'Chọn ít nhất một kỹ năng.' };
  const stored = examFields(formFromExam(exam));
  const next = examFields(form);
  const active = [
    ['listening_test_id', exam.listeningTestId, form.skills.includes('listening'), 'đề Listening'],
    ['reading_test_id', exam.readingTestId, form.skills.includes('reading'), 'đề Reading'],
    ['writing_task1_prompt_id', exam.writingTask1PromptId, form.skills.includes('writing'), 'đề Writing Task 1'],
    ['writing_task2_prompt_id', exam.writingTask2PromptId, form.skills.includes('writing'), 'đề Writing Task 2'],
    ['starts_at', exam.startsAt, form.mode === 'live', 'giờ bắt đầu'],
    ['open_from', exam.openFrom, form.mode === 'self_paced', 'giờ mở'],
    ['open_until', exam.openUntil, form.mode === 'self_paced', 'giờ đóng'],
  ];
  const cleared = active.find(([field, saved, remainsActive]) => remainsActive && saved && next[field] === null);
  if (cleared) return { ok: false, error: `Không thể bỏ ${cleared[3]} đã lưu. Chọn giá trị mới để lưu.` };

  const body = {};
  for (const [key, value] of Object.entries(next)) {
    const same = Array.isArray(value) ? JSON.stringify(value) === JSON.stringify(stored[key]) : value === stored[key];
    if (!same && value !== null) body[key] = value;
  }
  if (step && step !== exam.draftStep) body.draft_state = { step };
  return { ok: true, value: body };
}

/** Listening buffer and default length, as `_section_duration_seconds` in the service. */
export const LISTENING_BUFFER_SECONDS = 120;
const LISTENING_DEFAULT_SECONDS = 30 * 60 + LISTENING_BUFFER_SECONDS;

/**
 * Minutes a self-paced learner needs in one go (FR-143 "khoảng N phút").
 * Listening counts its seat clock: `listeningSeconds` (audio + buffer) when
 * known, else the exam's stored value, else the server default of 30 + 2.
 */
export function sittingMinutes(exam, skills, listeningSeconds = null) {
  let total = 0;
  if (skills.includes('listening')) {
    total += Math.round((listeningSeconds || exam?.listeningSeconds || LISTENING_DEFAULT_SECONDS) / 60);
  }
  if (skills.includes('reading')) total += exam?.readingMinutes || 60;
  if (skills.includes('writing')) total += exam?.writingMinutes || 60;
  return total;
}

export function modeLine(form, exam, listeningSeconds = null) {
  if (form.mode !== 'self_paced') return null;
  const n = sittingMinutes(exam, form.skills, listeningSeconds);
  const extra = form.skills.includes('speaking') ? ', chưa tính Speaking' : '';
  return n ? `Người thi cần một quãng liền khoảng ${n} phút${extra}.` : null;
}

// ── Audience (FR-142) ───────────────────────────────────────────────────────

/** `GET|PATCH .../audience`, or null outside the contract. */
export function normalizeAudience(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.items)) return null;
  const items = [];
  for (const raw of value.items) {
    const studentId = text(raw?.student_id);
    if (!studentId) continue;
    const kind = ['cohort', 'learner', 'group'].includes(raw?.source?.kind) ? raw.source.kind : 'learner';
    items.push({
      studentId,
      userId: text(raw.user_id),
      name: text(raw.name) || 'Chưa có tên',
      source: text(raw?.source?.label) || (kind === 'cohort' ? 'Lớp' : kind === 'group' ? 'Nhóm' : 'Học viên lẻ'),
      sourceKind: kind,
      skills: skillList(raw.skills) || [],
      selected: raw.selected === true,
      note: text(raw.excluded_reason),
    });
  }
  return { items, mirrorFailed: value.mirror_failed === true };
}

export function audienceSummary(items) {
  const selected = items.filter((i) => i.selected);
  const sources = new Map();
  for (const item of items) {
    const key = item.sourceKind === 'cohort' ? item.source : item.sourceKind === 'group' ? 'Nhóm' : 'Học viên lẻ';
    sources.set(key, (sources.get(key) || 0) + 1);
  }
  const parts = [...sources].map(([label, n]) => `${label} (${n})`);
  return {
    selected: selected.length,
    total: items.length,
    line: items.length ? `${selected.length} người được chọn trong ${items.length} người của danh sách · ${parts.join(' · ')}` : null,
    unselected: items.length - selected.length,
  };
}

/** Why a row has no account → why it is not selected (FR-142). */
export function audienceNote(item) {
  if (!item.userId) return item.note || 'Chưa có tài khoản nên chưa chọn được';
  return item.note;
}

// ── Lên lịch (FR-144) ───────────────────────────────────────────────────────

const MISSING_COPY = {
  listening_paper: 'Listening chưa có đề',
  reading_paper: 'Reading chưa có đề',
  writing_paper: 'Writing chưa có đề',
  speaking_paper: 'Speaking chưa có đề',
  paper_not_ready: 'Một đề đã chọn chưa sẵn sàng (đề bị gỡ hoặc Listening thiếu audio)',
  audience: 'Chưa có người thi nào được chọn',
  starts_at: 'Chưa có ngày giờ thi',
  window: 'Chưa có khoảng mở (cần ngày giờ đóng)',
};

export function missingCopy(code) {
  return MISSING_COPY[code] || 'Còn thiếu một điều kiện';
}

/**
 * What still blocks "Lên lịch", read from the saved exam and audience (same
 * rules as `schedule_missing` in the service; the server re-checks on click).
 */
export function scheduleMissing(exam, audience) {
  if (!exam) return ['audience'];
  const missing = [];
  const has = (s) => exam.skills.includes(s);
  if (has('listening') && !exam.listeningTestId) missing.push('listening_paper');
  if (has('reading') && !exam.readingTestId) missing.push('reading_paper');
  if (has('writing') && !exam.writingTask1PromptId && !exam.writingTask2PromptId) missing.push('writing_paper');
  if (has('speaking') && !exam.hasSpeakingPaper) missing.push('speaking_paper');
  if (!audience || !audience.items.some((i) => i.selected)) missing.push('audience');
  if (exam.mode === 'live') {
    if (!exam.startsAt) missing.push('starts_at');
  } else if (!exam.openUntil) {
    missing.push('window');
  }
  return missing;
}

/** The 422 `not_ready` of `POST .../schedule` → its `missing` codes, else null. */
export function notReadyMissing(error) {
  const detail = error?.detail ?? error?.body?.detail ?? error?.data?.detail;
  if (detail && detail.code === 'not_ready' && Array.isArray(detail.missing)) {
    return detail.missing.filter((m) => typeof m === 'string');
  }
  return null;
}
