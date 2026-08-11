/**
 * frontend/js/listening-test-player.js — Sprint 13.5
 *
 * Student full-test player. Three states:
 *
 *   1. PRE-START — fetch GET /api/listening/tests/{id}, render rules
 *      + "Bắt đầu test" button. Confirm dialog before consuming an
 *      attempt slot (an attempt is only created when the student clicks
 *      Start).
 *
 *   2. PLAYER — POST /api/listening/tests/{id}/attempts, then render
 *      the 4-section question paper + custom audio controls. Audio has
 *      Play/Pause + speed (0.75/1/1.25) + volume — NO seek/rewind
 *      (Cambridge constraint). Each answer change debounces 500ms and
 *      PATCHes /api/listening/tests/attempts/{id}/answers, with a retry
 *      ladder + a visible cue for anything the server does not hold (A4a).
 *      A still-open attempt can be RESUMED from pre-start instead of
 *      being abandoned (A1).
 *
 *   3. RESULT — POST /api/listening/tests/attempts/{id}/submit, render
 *      score + band + section breakdown + trap analytics + per-Q list.
 */

const SUPABASE_URL  = 'https://huwsmtubwulikhlmcirx.supabase.co';
const SUPABASE_ANON = 'sb_publishable_hvevBST9lgIWRd5ITHtUpA_SYjiX6Ao';

(function bootstrapSupabase() {
  if (typeof window !== 'undefined' && window.initSupabase) {
    try { window.initSupabase(SUPABASE_URL, SUPABASE_ANON); } catch { /* swallow */ }
  }
})();

const $ = (id) => document.getElementById(id);

const STATE = {
  testId:        null,
  test:          null,
  attemptId:     null,
  audio:         null,
  answers:       new Map(),   // q_num → user_answer
  saveTimers:    new Map(),   // q_num → setTimeout handle
  inflight:      new Set(),   // q_nums mid-PATCH
  // A4a — an answer is "unsaved" from the moment its first save attempt fails
  // until one succeeds. saveGen keeps an older retry from clearing a newer
  // failure's cue; saveRetryTimers lets a fresh edit cancel a pending retry.
  unsaved:       new Map(),   // q_num → 'retrying' | 'failed'
  saveRetryTimers: new Map(), // q_num → setTimeout handle
  saveGen:       new Map(),   // q_num → generation counter
  // NOTHING-IS-LANDING DETECTOR. A student sat a full 30-minute Listening
  // section, auto-submitted, and was graded 0 because the server held ZERO
  // answers — with no error anywhere and nothing on his screen to tell him
  // (prod, 2026-07-26). The per-question cue only speaks for a question whose
  // OWN save failed; it cannot say "none of this is reaching the server",
  // which is the one failure a student can still act on while there is time.
  triedSaveAt:   null,        // ms of the first save ATTEMPT
  serverHasOne:  false,       // a save the server CONFIRMED
  nothingReported: false,     // the server-side alert, sent once
  nothingTimer:  null,
  // An open attempt the server still holds for this (user, test), found at
  // prestart. Non-null → the resume button is on screen and "Bắt đầu test"
  // means "throw that away and start over".
  resumable:     null,
  submitting:    false,
  // Sprint 13.5.5 — tab navigation state + audio cue auto-advance.
  activeTab:     1,
  cuePointsByTab: new Map(), // tabNum → first cue timestamp (seconds)
  // Sprint 13.5.7 — Cambridge single-shot play guard: once true, the
  // Play button is locked for the rest of the attempt.
  playbackStarted: false,
  // Listening mini test — the real shape, derived from the loaded test (a full
  // test = 4 sections / 40 Q; a mini = 1 section / M Q). Replaces the hardcoded
  // 4/40 so the player renders both. Set by computeTestShape() at load.
  qToSection:    new Map(),   // q_num → section_num (from the test data)
  totalQuestions: 40,
  sectionCount:   4,
  sectionQCounts: {},         // section_num → question count (for tab "n/m")
};

// Derive the test's real shape (section count, total questions, q→section map,
// per-section counts) from the loaded payload — NOT a hardcoded 4×10.
function computeTestShape(test) {
  const sections = (test && test.sections) || [];
  const qToSection = new Map();
  const counts = {};
  let total = 0;
  sections.forEach((sec) => {
    const sn = Number(sec.section_num);
    (sec.exercises || []).forEach((e) => {
      ((e.payload && e.payload.questions) || []).forEach((q) => {
        if (q && q.q_num != null) {
          qToSection.set(Number(q.q_num), sn);
          counts[sn] = (counts[sn] || 0) + 1;
          total += 1;
        }
      });
    });
  });
  STATE.qToSection    = qToSection;
  STATE.totalQuestions = total || 40;
  STATE.sectionCount   = sections.length || 4;
  STATE.sectionQCounts = counts;
  // The first section's REAL number (a full test starts at 1, but a mini may be
  // a single "Section 3" → section_num=3). Used to seed the active tab; seeding
  // it to a hardcoded 1 would hide the only panel (applyActiveTab hides every
  // section whose num != activeTab) and the test looks blank.
  STATE.firstSection = sections.length ? Number(sections[0].section_num) : 1;
}

// Q-number → section number — from the test's actual data (handles a mini's
// single section as well as a full 4-section test). Falls back to the Cambridge
// 10-per-section convention only if the map is unavailable.
function sectionForQ(qNum) {
  const n = Number(qNum);
  if (STATE.qToSection && STATE.qToSection.has(n)) return STATE.qToSection.get(n);
  if (!Number.isFinite(n) || n < 1 || n > (STATE.totalQuestions || 40)) return null;
  return Math.floor((n - 1) / 10) + 1;
}

const VIEWS = {
  loading:   $('state-loading'),
  missing:   $('state-missing'),
  error:     $('state-error'),
  prestart:  $('ft-prestart'),
  player:    $('ft-player'),
  result:    $('ft-result'),
};

function showState(name) {
  VIEWS.loading.hidden  = name !== 'loading';
  VIEWS.missing.hidden  = name !== 'missing';
  VIEWS.error.hidden    = name !== 'error';
  VIEWS.prestart.hidden = name !== 'prestart';
  VIEWS.player.hidden   = name !== 'player';
  VIEWS.result.hidden   = name !== 'result';
}
function showError(msg) {
  VIEWS.error.textContent = msg;
  showState('error');
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Render inline markdown emphasis (**bold**, *italic*) in user-facing prose so
// generator-emitted markdown doesn't show up literally (e.g. "**NO MORE THAN
// TWO WORDS**", "*(ONE WORD)*"). XSS-safe: HTML is escaped FIRST, so the only
// tags that ever reach the DOM are the <strong>/<em> we introduce here. Use
// for PROSE only (prompts, instructions, option text) — never attribute values.
function mdInline(raw) {
  let s = esc(raw);
  s = s.replace(/\*\*([^*]+)\*\*/g, (_, t) => `<strong>${t}</strong>`);
  s = s.replace(/\*([^*\n]+)\*/g,   (_, t) => `<em>${t}</em>`);
  return s;
}

// Gap-fill prompt → render the answer input INLINE at the blank token (____ /
// …… / ....) instead of appended at the end, for ANY gap-fill type that reaches
// the fallback. Falls back to appending only when the prompt has no blank.
const _GAP_TOKEN_RE = /_{2,}|…+|\.{4,}/;
function renderGapPrompt(prompt, qNum) {
  const html = mdInline(prompt || '');
  if (_GAP_TOKEN_RE.test(html)) {
    return html.replace(_GAP_TOKEN_RE, () => gapInput(qNum));
  }
  return html + ' ' + gapInput(qNum);
}

// "Questions 4 – 6" for a real range; "Question 5" for a single item
// (lo === hi). Lessons author one heading per item (### Question 5), so the
// per-block range is N–N — render the natural singular instead of "Questions
// 5 – 5".
function questionRangeLabel(lo, hi) {
  return lo === hi
    ? `Question ${esc(lo)}`
    : `Questions ${esc(lo)} – ${esc(hi)}`;
}

function getTestIdFromUrl() {
  const sp = new URLSearchParams(window.location.search);
  return (sp.get('id') || '').trim() || null;
}

// Class homework. The class page puts `?class_item=` on the link so this
// attempt can record WHICH task it is being done for — the ledger then never
// has to work that out from the paper and the clock, which cannot be done right
// when the same paper may be given twice or practised freely on the side.
function getClassItemFromUrl() {
  const sp = new URLSearchParams(window.location.search);
  return (sp.get('class_item') || '').trim() || null;
}

// ── Back target ──────────────────────────────────────────────────────
// This player serves BOTH listening libraries (listening-tests.html = full,
// listening-mini-test.html = mini), which stamp ?from= on the link in. Every
// "back to the list" link used to hardcode the FULL library, so a mini-test
// taker was sent to the wrong shelf. Map through an ALLOWLIST — never navigate
// to a raw URL from the query string. Unknown/absent → full (the historical
// default, and what the mock embed gets — its back links are not shown anyway).
const BACK_TARGETS = {
  full:     '/listening/tests',
  mini:     '/listening/mini-test',
  drill:    '/listening/skills',
  practice: '/listening/practice',
};
function originFromUrl() {
  const v = (new URLSearchParams(window.location.search).get('from') || '').trim();
  return BACK_TARGETS[v] ? v : 'full';
}
function wireBack() {
  const href = BACK_TARGETS[originFromUrl()];
  document.querySelectorAll('a[href="/listening/tests"]')
    .forEach((a) => { a.href = href; });
}

function fmtTime(secs) {
  if (!Number.isFinite(secs) || secs < 0) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}


// ── Initial load ─────────────────────────────────────────────────────

async function loadTest(testId) {
  showState('loading');
  try {
    const test = await window.api.get(`/api/listening/tests/${encodeURIComponent(testId)}`);
    STATE.testId = testId;
    STATE.test   = test;
    computeTestShape(test);            // sets sectionCount / totalQuestions / qToSection / firstSection
    STATE.activeTab = STATE.firstSection;   // a mini may start at Section 3, not 1
    const testType = test.test_type || 'full';
    document.body.setAttribute('data-listening-mode', testType);
    const kindLabel = testType === 'mini'
      ? 'MINI LISTENING TEST'
      : (testType === 'drill' || testType === 'practice')
        ? 'LISTENING PRACTICE'
        : 'FULL LISTENING TEST';
    const kind = $('ft-kind');
    if (kind) kind.textContent = kindLabel;
    const practice = isPracticeTest(test);
    const audioRule = $('ft-prestart-audio-rule');
    const controlRule = $('ft-prestart-control-rule');
    if (audioRule) {
      audioRule.textContent = practice
        ? 'Bạn có thể tạm dừng, tua và nghe lại audio để luyện tập chủ động.'
        : 'Audio phát trong một lượt như đề thật — không tua, không phát lại từ đầu.';
    }
    if (controlRule) {
      controlRule.textContent = practice
        ? 'Thanh tiến độ cho phép quay lại đúng đoạn bạn muốn nghe thêm.'
        : 'Kiểm tra âm lượng trước khi bắt đầu; trong lúc làm bài bạn chỉ có thể điều chỉnh âm lượng.';
    }
    $('ft-title').textContent = test.title || test.test_id || 'Untitled';
    $('ft-subtitle').textContent =
      `${STATE.sectionCount} section${STATE.sectionCount > 1 ? 's' : ''} · ${STATE.totalQuestions} câu`;
    // Mirror the real counts into the static prestart rule + answered-denominator.
    var ruleEl = $('ft-prestart-rule-count');
    if (ruleEl) ruleEl.textContent = STATE.totalQuestions + ' câu trên ' + STATE.sectionCount +
      ' section' + (STATE.sectionCount > 1 ? 's' : '');
    document.querySelectorAll('[data-total-q]').forEach(function (el) {
      el.textContent = String(STATE.totalQuestions);
    });
    $('ft-prestart-title').textContent = `Sẵn sàng bắt đầu — ${test.title || test.test_id || ''}`;
    await detectResumable();
    showState('prestart');
  } catch (e) {
    const msg = (e && e.message) || String(e);
    if (msg.includes('404')) {
      showError('Test không tồn tại hoặc chưa được xuất bản.');
    } else if (msg.includes('422')) {
      showError('Test này chưa có audio sẵn sàng. Quay lại sau.');
    } else {
      showError(`Không tải được test: ${msg}`);
    }
  }
}


// ── Start attempt + render player ────────────────────────────────────

// ── Resume an interrupted attempt ────────────────────────────────────
//
// Until this existed the ONLY way into an attempt was startAttempt(), which
// asks the server for a new one — and the server abandons the open attempt to
// honour the 1-active-attempt invariant. So a refresh, a dropped connection, or
// (inside a 4-skill mock) the embed's automatic start-click silently destroyed
// every answer the student had given, with the class clock still running and
// the audio not rewindable. Reading has had a resume path since Sprint 20.11;
// Listening simply never got one.

async function detectResumable() {
  try {
    // Inside a mock, scope the lookup to THIS sitting. Unscoped, a standalone
    // practice attempt the student left open on the same test would be
    // auto-resumed by the embed and then bound to the sealed sitting.
    const sid = (window.MockHook && MockHook.active()) ? MockHook.sittingId() : null;
    // Class homework scopes the same way a mock sitting does. Resuming skips
    // the POST that stamps the class link, so an unfinished free-practice
    // attempt on this test must not be offered here — the student would finish
    // it, submit it, and still owe the homework.
    const classItem = getClassItemFromUrl();
    const qs = [
      sid ? `sitting_id=${encodeURIComponent(sid)}` : '',
      classItem ? `class_item=${encodeURIComponent(classItem)}` : '',
    ].filter(Boolean).join('&');
    const res = await window.api.get(
      `/api/listening/tests/${encodeURIComponent(STATE.testId)}/attempts/in-progress`
      + (qs ? `?${qs}` : ''),
    );
    const att = res && res.attempt;
    if (!att) return;
    STATE.resumable = att;
    const n = (att.answers || []).length;
    $('ft-resume-note').textContent = n
      ? `Bạn có một bài đang làm dở với ${n} câu đã lưu. Bấm "Tiếp tục" để làm tiếp — bấm "Bắt đầu test" sẽ BỎ số câu đó và làm lại từ đầu.`
      : 'Bạn có một bài đang làm dở (chưa lưu câu nào). Bấm "Tiếp tục" để làm tiếp.';
    $('ft-resume-note').hidden = false;
    $('ft-resume-btn').hidden = false;
    // IN A MOCK, RESTART IS NOT A STUDENT ACTION. The exam contract is one
    // sealed attempt; "Bắt đầu test" abandons the answered row and mints a
    // blank one, which attach_attempt() then refuses ("không thể thay bằng bài
    // trống") — leaving the sitting bound to the abandoned attempt and the
    // section unusable. Cancelling a sitting is the admin's "Huỷ lượt", not a
    // button inside the paper (Codex review, PR #834).
    if (window.MockHook && MockHook.active()) {
      const restart = $('btn-start');
      if (restart) restart.hidden = true;
      $('ft-resume-note').textContent =
        `Bạn có một bài đang làm dở với ${n} câu đã lưu. Bấm "Tiếp tục" để làm tiếp.`;
    }
  } catch (e) {
    console.warn('[listening] resume lookup failed', e);
    // FAIL CLOSED. Falling through to a normal pre-start meant the mock embed's
    // auto-click hit "Bắt đầu test", whose POST ABANDONS the answered attempt —
    // turning the very dropped-network case this feature exists to survive into
    // a destroyed sitting (Codex review, PR #834). Until the server has said
    // whether an attempt exists, Start must not be reachable.
    STATE.resumeUnknown = true;
    const startBtn = $('btn-start');
    if (startBtn) { startBtn.disabled = true; startBtn.textContent = 'Đang kiểm tra bài cũ…'; }
    const note = $('ft-resume-note');
    if (note) {
      note.textContent = 'Chưa kiểm tra được bạn có bài đang làm dở hay không '
        + '(mất kết nối). Đang thử lại — đừng bấm gì để tránh mất bài.';
      note.hidden = false;
    }
    setTimeout(retryDetectResumable, 3000);
  }
}

// Keep retrying the resume lookup. Only once it answers do we know whether
// starting over is safe, so this is what re-enables the Start button.
async function retryDetectResumable() {
  if (!STATE.resumeUnknown) return;
  STATE.resumeUnknown = false;
  await detectResumable();
  if (!STATE.resumeUnknown) {
    const startBtn = $('btn-start');
    if (startBtn) { startBtn.disabled = false; startBtn.textContent = 'Bắt đầu test'; }
    if (!STATE.resumable) {
      const note = $('ft-resume-note');
      if (note) note.hidden = true;
    }
  }
}

async function resumeAttempt() {
  const att = STATE.resumable;
  if (!att) return;
  $('ft-resume-btn').disabled = true;
  STATE.attemptId = att.attempt_id;
  for (const a of (att.answers || [])) {
    if (a && a.q_num != null) STATE.answers.set(a.q_num, a.user_answer);
  }
  // SEED FROM THE RESUME PAYLOAD. Answers already on the attempt are proof the
  // server has this student's work — so the alarm must NOT claim otherwise if a
  // later save fails. Without this, resuming and then losing the connection for
  // 45s told a student with a full paper on the server that it held nothing and
  // they would be graded 0 (Codex review, PR #860). A failing save after a
  // resume is a per-question problem, and the amber cue already owns it.
  if ((att.answers || []).length) STATE.serverHasOne = true;
  startNothingSavedWatch();
  try {
    // Re-link (idempotent) in case a create-time attach failed and left the
    // attempt unsealed — mirrors reading-exam.js's resume branch.
    if (window.MockHook && MockHook.active()) {
      await MockHook.attach('listening', att.attempt_id);
    }
    renderPaper();
    restoreAnswersIntoPaper();
    mountAudio();
    await seekAudioToRoom();
    showState('player');
  } catch (e) {
    $('ft-resume-btn').disabled = false;
    showError(`Không tiếp tục được bài: ${(e && e.message) || e}`);
  }
}

// Paint the recovered answers back onto the freshly-rendered paper and refresh
// the counters, so the student sees their work rather than being told a number.
function restoreAnswersIntoPaper() {
  for (const [qNum, val] of STATE.answers.entries()) {
    document.querySelectorAll(`.ft-q-input[data-q-num="${qNum}"]`).forEach((el) => {
      if (el.type === 'radio') el.checked = (el.value === val);
      else el.value = val == null ? '' : val;
    });
  }
  restoreMultiSelectGroups();
  updateAnsweredCount();
  renderProgressTracker();
}

// mcq_multi renders its choices as `.ft-mc-box` checkboxes WITHOUT data-q-num
// (the group maps N checked letters onto N q-slots), so the loop above cannot
// see them. Left unrestored they came back visually unchecked even though the
// answers were recovered — and then ticking one more option remapped only the
// newly-checked values onto the slots and scheduled BLANK saves for the rest,
// overwriting recovered answers (Codex review, PR #834).
function restoreMultiSelectGroups() {
  document.querySelectorAll('.ielts-mc-group').forEach((grp) => {
    const slots = (grp.getAttribute('data-mm-slots') || '')
      .split(',').map(Number).filter(Number.isFinite);
    const choose = Number(grp.getAttribute('data-mm-choose')) || slots.length || 2;
    const letters = slots
      .map((slot) => STATE.answers.get(slot))
      .filter((v) => v != null && v !== '');
    if (!letters.length) return;
    const boxes = Array.from(grp.querySelectorAll('.ft-mc-box'));
    boxes.forEach((b) => { b.checked = letters.indexOf(b.value) !== -1; });
    // Re-apply the same N-pick soft-lock the change handler maintains, so a
    // resumed group behaves identically to one filled in this sitting.
    const lock = boxes.filter((b) => b.checked).length >= choose;
    boxes.forEach((b) => { if (!b.checked) b.disabled = lock; });
  });
}

// Rejoin the room where it actually is. The mock's Listening clock is stamped
// on the EXAM (one shared classroom clock), so elapsed-since-the-invigilator-
// opened-the-section is the correct audio position — the student loses the
// audio that played while they were disconnected, exactly as in a real hall.
// Outside a mock there is no shared anchor, so the audio is left alone.
// Where the audio should be when a resumed attempt remounts, or null to leave
// it alone.
//
//   · MOCK  — the shared classroom clock on the exam (the whole room is at the
//             same point, so that is the only honest anchor).
//   · FULL standalone — this attempt's own `started_at`, which the server
//             returns with the resumable attempt. Leaving it at 0 let a
//             refreshed student replay audio they had already heard, breaking
//             the single-shot/no-rewind contract that the very same file
//             enforces by disabling scrub (Codex review, PR #834).
//   · MINI / DRILL — practice deliberately allows pause, seek and replay, so
//             there is nothing to restore.
async function resumeAudioOffsetSeconds() {
  if (window.MockHook && MockHook.active() && MockHook.sectionElapsedSeconds) {
    return await MockHook.sectionElapsedSeconds('listening');
  }
  if (STATE.scrub) return null;                     // mini / drill: free replay
  const startedAt = STATE.resumable && STATE.resumable.started_at;
  if (!startedAt) return null;
  const started = Date.parse(startedAt);
  if (!started) return null;
  const secs = Math.floor((Date.now() - started) / 1000);
  return secs > 0 ? secs : null;
}

async function seekAudioToRoom() {
  const elapsed = await resumeAudioOffsetSeconds();
  if (elapsed == null || !STATE.audio) return;
  try {
    STATE.audio.currentTime = elapsed;
  } catch (e) {
    // Some browsers reject a seek before metadata lands — retry once it does.
    STATE.audio.addEventListener('loadedmetadata', function once() {
      STATE.audio.removeEventListener('loadedmetadata', once);
      try { STATE.audio.currentTime = elapsed; } catch (err) { /* give up quietly */ }
    });
  }
}

function isPracticeTest(test) {
  const tt = test && test.test_type;
  return tt === 'mini' || tt === 'drill' || tt === 'practice';
}

async function startAttempt() {
  // 4-skill mock (mock_embed): skip the native confirm — it would pop from the
  // hidden child iframe, and a dismiss/block would leave the listening attempt
  // unattached. The parent's prep screen already confirmed the start.
  var _embed = window.MockHook && MockHook.embedded && MockHook.embedded();
  if (!_embed) {
    const ok = window.confirm(isPracticeTest(STATE.test)
      ? 'Bắt đầu luyện nghe? Bạn có thể tạm dừng, tua và nghe lại audio trước khi nộp bài.'
      : 'Bắt đầu test? Audio sẽ phát ngay và không thể tua lại. ' +
        'Bài thi sẽ kết thúc khi bạn nộp bài hoặc audio chạy hết.');
    if (!ok) return;
  }

  $('btn-start').disabled = true;
  $('btn-start').textContent = 'Đang khởi tạo…';

  try {
    const classItem = getClassItemFromUrl();
    const res = await window.api.post(
      `/api/listening/tests/${encodeURIComponent(STATE.testId)}/attempts`
        + (classItem ? `?class_item=${encodeURIComponent(classItem)}` : ''),
      {},
    );
    STATE.attemptId = res.attempt_id;
    startNothingSavedWatch();
    // Mock sitting: link this attempt so its submit is sealed server-side.
    // Fail-closed — do not start the audio/exam until the link is written
    // (otherwise a submit before attach would return an unsealed score).
    if (window.MockHook && MockHook.active()) {
      await MockHook.attach('listening', res.attempt_id);
    }
    renderPaper();
    mountAudio();
    showState('player');
  } catch (e) {
    $('btn-start').disabled = false;
    $('btn-start').textContent = 'Bắt đầu test';
    showError(`Không tạo được attempt: ${(e && e.message) || e}`);
  }
}


// ── Question paper rendering — Sprint 13.5.2 Cambridge-authentic ─────
//
// Each exercise's `payload.template_kind` (form_completion /
// table_completion / notes_completion / sentence_completion /
// summary_completion / short_answer / mcq_3option / plan_label)
// dispatches to a variant-specific renderer. The renderer reads
// `payload.template` for structural context that the Sprint 13.5.2
// parser preserves alongside the question list.
//
// Every gap or MCQ input carries `data-q-num="<N>"` + class
// `ft-q-input` so the existing change handler picks them up
// without modification.

function renderPaper() {
  const root = $('ft-paper');
  const sections = (STATE.test && STATE.test.sections) || [];
  const totalQs = sections.reduce(
    (a, s) => a + (s.exercises || [])
      .reduce((b, e) => b + ((e.payload && e.payload.questions) || []).length, 0),
    0,
  );
  const out = ['<div class="ielts-test-paper">'];
  for (const sec of sections) {
    const range = sectionQuestionRange(sec);
    // Sprint 13.5.7 — narrator intro is audio-only in real Cambridge
     // IELTS exams. The text version exists in the data for admin
     // preview + debugging but must NOT render in the student paper.
    out.push(`
      <section class="ielts-section" data-section-num="${esc(sec.section_num)}">
        <div class="ielts-section-label">PART ${esc(sec.section_num)}</div>
        <h2 class="ielts-section-title">${questionRangeLabel(range[0], range[1])}</h2>
        ${(sec.exercises || []).map(renderExercise).join('')}
      </section>
    `);
  }
  out.push('</div>');
  root.innerHTML = out.join('');
  if (totalQs) { /* total Q count not displayed; preserve for future stats */ }
  attachQuestionHandlers();
  // Listening mini test — render ONE tab per real section (a mini has 1, a full
  // test has 4) instead of the static 4 in the HTML.
  renderTabs();
  // Sprint 13.5.5 — tab navigation: show only the active tab's section.
  applyActiveTab();
  // Sprint 13.5.5 — render the 40-square progress tracker.
  renderProgressTracker();
  attachTabHandlers();
  attachProgressHandlers();
}

// Listening mini test — build one tab per real section from the test data.
function renderTabs() {
  const tabs = $('ft-tabs');
  if (!tabs) return;
  const sections = (STATE.test && STATE.test.sections) || [];
  tabs.innerHTML = sections.map((sec) => {
    const sn = Number(sec.section_num);
    const cnt = STATE.sectionQCounts[sn] || 0;
    const active = sn === STATE.activeTab;
    return `<button class="ielts-tab${active ? ' active' : ''}" data-tab="${sn}" type="button" role="tab" aria-selected="${active ? 'true' : 'false'}">`
      + `<span class="tab-label">PART ${sn}</span>`
      + `<span class="tab-progress" data-tab-progress="${sn}">0/${cnt}</span></button>`;
  }).join('');
}

function applyActiveTab() {
  const sections = document.querySelectorAll('#ft-paper .ielts-section');
  sections.forEach((el) => {
    const n = Number(el.getAttribute('data-section-num'));
    el.hidden = (n !== STATE.activeTab);
  });
  document.querySelectorAll('#ft-tabs .ielts-tab').forEach((el) => {
    const n = Number(el.getAttribute('data-tab'));
    const isActive = (n === STATE.activeTab);
    el.classList.toggle('active', isActive);
    el.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
}

function setActiveTab(tabNum) {
  // Valid tabs are the REAL section numbers (a mini may be just {3}), not 1..count.
  const known = STATE.sectionQCounts && Object.prototype.hasOwnProperty.call(STATE.sectionQCounts, tabNum);
  if (!Number.isInteger(tabNum) || (!known && (tabNum < 1 || tabNum > (STATE.sectionCount || 4)))) return;
  if (STATE.activeTab === tabNum) return;
  STATE.activeTab = tabNum;
  applyActiveTab();
  // Bring the new panel into view (under the sticky audio bar).
  const panel = document.querySelector(
    `#ft-paper .ielts-section[data-section-num="${tabNum}"]`,
  );
  if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function attachTabHandlers() {
  document.querySelectorAll('#ft-tabs .ielts-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      const n = Number(btn.getAttribute('data-tab'));
      setActiveTab(n);
    });
  });
}

// Sprint 13.5.5 — Cambridge-style auto-advance: when the audio enters
// a new section's cue window, flip the question paper to that PART.
// The user can still override by clicking another tab; auto-advance
// only fires when the active tab is behind the audio (so a user who
// clicks ahead to PART 4 while audio is still in PART 2 isn't yanked
// backwards).
function maybeAutoAdvanceTab(currentTime) {
  if (!Number.isFinite(currentTime)) return;
  let bestTab = STATE.activeTab;
  for (const [tabNum, ts] of STATE.cuePointsByTab.entries()) {
    if (currentTime + 0.5 >= ts && tabNum > bestTab) {
      bestTab = tabNum;
    }
  }
  if (bestTab !== STATE.activeTab) {
    setActiveTab(bestTab);
  }
}


// ── Progress tracker (40 squares + counter + submit) ────────────────

function renderProgressTracker() {
  const bar = $('ft-progress-bar');
  if (!bar) return;
  const html = [];
  for (let q = 1; q <= (STATE.totalQuestions || 40); q++) {
    const section = sectionForQ(q);
    html.push(
      `<button class="progress-square" type="button" `
      + `data-q-num="${q}" data-section="${section}" `
      + `title="Câu ${q} — Section ${section}" aria-label="Câu ${q}">${q}</button>`,
    );
  }
  bar.innerHTML = html.join('');
  // The squares were just rebuilt from scratch, so any unsaved cue painted on
  // the old nodes is gone. Re-apply it — a re-render must not silently tell the
  // student their answers are safe.
  STATE.unsaved.forEach((state, qNum) => setSaveState(qNum, state));
}

function attachProgressHandlers() {
  document.querySelectorAll('#ft-progress-bar .progress-square').forEach((sq) => {
    sq.addEventListener('click', () => {
      const q = Number(sq.getAttribute('data-q-num'));
      const section = Number(sq.getAttribute('data-section'));
      onProgressSquareClick(q, section);
    });
  });
}

function onProgressSquareClick(qNum, sectionNum) {
  if (sectionNum && STATE.activeTab !== sectionNum) {
    setActiveTab(sectionNum);
  }
  // After tab swap the input may not exist yet (renderPaper already
  // wrote the panel, just hidden). Scroll + focus in a microtask so
  // the hidden→visible toggle has flushed.
  setTimeout(() => {
    const input = document.querySelector(
      `#ft-paper .ft-q-input[data-q-num="${qNum}"]`,
    );
    if (!input) return;
    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (typeof input.focus === 'function') input.focus();
  }, 80);
}

function sectionQuestionRange(sec) {
  let lo = Infinity, hi = -Infinity;
  for (const ex of (sec.exercises || [])) {
    for (const q of ((ex.payload && ex.payload.questions) || [])) {
      if (Number.isFinite(q.q_num)) {
        if (q.q_num < lo) lo = q.q_num;
        if (q.q_num > hi) hi = q.q_num;
      }
    }
  }
  if (lo === Infinity) return ['?', '?'];
  return [lo, hi];
}

function renderExercise(ex) {
  const payload = ex.payload || {};
  const kind = payload.template_kind
    || payload.variant
    || ex.variant
    || ex.exercise_type
    || '';
  const questions = Array.isArray(payload.questions)
    ? payload.questions
    : (Array.isArray(payload.items) ? payload.items : []);
  const tmpl = payload.template || {};
  const meta = payload.metadata || {};
  const instruction = payload.instruction || payload.instructions || '';
  const range = questions.length
    ? [questions[0].q_num, questions[questions.length - 1].q_num]
    : null;

  const header = `
    <div class="ielts-question-block" data-template-kind="${esc(kind)}">
      ${range
        ? `<div class="ielts-block-header">${questionRangeLabel(range[0], range[1])}</div>`
        : ''}
      ${instruction
        ? `<div class="ielts-instruction">${formatInstruction(instruction)}</div>`
        : ''}
  `;
  const body = (() => {
    switch (kind) {
      case 'form_completion':     return renderFormCompletion(tmpl, questions);
      case 'table_completion':    return renderTableCompletion(tmpl, questions);
      case 'notes_completion':    return renderNotesCompletion(tmpl, questions);
      case 'summary_completion':  return renderSummaryCompletion(tmpl, questions);
      case 'sentence_completion': return renderSentenceCompletion(tmpl, questions);
      // A3 (P2) — flow-chart completion reuses the gap-fill renderer: each step
      // is a prompt + text gap (graded as text via answer_matches, unchanged).
      case 'flow_chart_completion': return renderShortAnswer(questions);
      case 'short_answer':        return renderShortAnswer(questions);
      case 'mcq_3option':         return renderMCQ(questions);
      case 'mcq_multi':           return renderMultiSelect(payload, questions);
      case 'matching':            return renderMatching(payload, questions);
      case 'mcq_letter_label':
      case 'plan_label':          return renderPlanLabel(payload, questions);
      default:                    return renderFallback(questions);
    }
  })();
  return header + body + `</div>`;
}

function formatInstruction(raw) {
  // Each sentence on its own line preserves the second-line italic
  // emphasis pattern (`Write NO MORE THAN…`).
  // Tách câu KHÔNG dùng lookbehind: cú pháp đó cần Safari 16.4, mà
  // file này phục vụ NGUYÊN XI (không qua bundler) nên iPhone iOS ≤16.3 không
  // parse nổi CẢ FILE ⇒ chết toàn bộ trình phát bài nghe, không riêng hàm này
  // (DEBT-2026-07-29-K, review #882). Giữ nguyên hành vi bằng cách bắt dấu câu
  // vào nhóm rồi chèn ký tự mốc; lookahead `(?=…)` thì mọi trình duyệt đều có.
  // Tách ở CẢ dấu hỏi/chấm than, không riêng dấu chấm: khối matching mở đầu
  // bằng chính câu hỏi ("What comment do the students make…?") rồi mới tới câu
  // lệnh, nên chỉ bắt dấu chấm thì hai thứ dính làm một và học viên không phân
  // biệt được đâu là đề bài, đâu là hướng dẫn.
  const parts = String(raw)
    .replace(/([.?!])\s+(?=[A-Z])/g, '$1\u0000')
    .split('\u0000')
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length <= 1) return `<p>${mdInline(raw)}</p>`;
  // Đánh dấu theo VAI TRÒ, không theo thứ tự. Trên đề thật câu lệnh có khi
  // đứng trước ("Choose TWO letters, A-E." rồi mới tới câu hỏi), có khi đứng
  // sau (khối matching) — kiểu chữ bám vai trò thì mới nhất quán cả hai chiều.
  const DIRECTIVE_RE = /^(Choose|Write|Complete|Label|Match|Answer|Select)\b/i;
  return parts.map((part) => {
    const cls = DIRECTIVE_RE.test(part) ? 'is-directive'
      : (/\?$/.test(part) ? 'is-question' : '');
    return `<p${cls ? ` class="${cls}"` : ''}>${mdInline(part)}</p>`;
  }).join('');
}


// ── Form completion ─────────────────────────────────────────────────

function renderFormCompletion(tmpl, questions) {
  const heading = tmpl.heading || '';
  const rows = Array.isArray(tmpl.rows) ? tmpl.rows : [];
  if (!rows.length) return renderFallback(questions);
  return `
    <div class="ielts-form-container">
      ${heading ? `<div class="ielts-form-heading">${esc(heading)}</div>` : ''}
      <div class="ielts-form-grid">
        ${rows.map((r) => {
          // A form can hold lines that are plain sentences rather than
          // label/value pairs — Cambridge 21 Test 4 Part 1 ends with "Likes the
          // (9) ……… best". Forcing a label onto one splits the sentence with a
          // colon ("Likes the: 9 ___ best"), so an empty label renders nothing.
          const label = r.label
            ? `<span class="ielts-form-label">${mdInline(r.label)}:</span>`
            : '';
          if (r.example != null) {
            return `<div class="ielts-form-row">
              ${label}
              <span class="ielts-form-example">${mdInline(r.example)} (Example)</span>
            </div>`;
          }
          // A form line can hold more than one gap, and text after the gap as
          // well as before it ("Reason for visit: business (to buy antique
          // (2) ……… )"). `segments` covers those; the flat {prefix, q_num}
          // shape stays valid.
          if (Array.isArray(r.segments)) {
            return `<div class="ielts-form-row">
              ${label}
              ${r.segments.map(tableGapSegment).join(' ')}
            </div>`;
          }
          if (r.q_num != null) {
            const pref = r.prefix
              ? `<span class="ielts-form-prefix">${mdInline(r.prefix)}</span>`
              : '';
            return `<div class="ielts-form-row">
              ${label}
              ${pref}
              <span class="ielts-question-num">${esc(r.q_num)}</span>
              ${gapInput(r.q_num)}${r.suffix ? ' ' + mdInline(r.suffix) : ''}
            </div>`;
          }
          return `<div class="ielts-form-row">
            ${label}
            <span>${mdInline(r.text || '')}</span>
          </div>`;
        }).join('')}
      </div>
    </div>
  `;
}


// ── Table completion ────────────────────────────────────────────────

// One piece of a table cell (or a form row's value): plain text, or a gap with
// text on either side of it.
//
// The paper needs both halves. Cambridge 20 Test 1 Part 1 prints "Good for
// people who are especially keen on (1) ………" — words BEFORE the input — and
// "Set lunch costs (9) ……… per person / Portions probably of (10) ……… size",
// which is one cell holding TWO gaps. A cell limited to {q_num, suffix} can
// express neither: the leading words vanish and the second gap has nowhere to
// go. So a cell may also be an ARRAY of these segments.
function tableGapSegment(seg) {
  if (seg == null) return '';
  if (typeof seg !== 'object') return mdInline(seg);
  if (seg.q_num == null) return mdInline(seg.text || '');
  return `${seg.prefix ? mdInline(seg.prefix) + ' ' : ''}` +
         `<span class="ielts-question-num">${esc(seg.q_num)}</span>` +
         `${gapInput(seg.q_num)}${seg.suffix ? ' ' + mdInline(seg.suffix) : ''}`;
}

// Một ô bảng dạng mảng KHÔNG phải "mỗi phần tử một dòng".
//
// `_cell_segments()` (listening_convert.py) dùng mảng cho các MẨU NỐI LIỀN quanh
// một chỗ trống — "Good for people who are especially keen on" + {q_num:1} là MỘT
// câu, tách ra là vỡ câu và tách ô nhập khỏi phần dẫn của nó. Nhưng đề thật cũng
// có ô chứa HAI Ý riêng biệt ("Checking portions, etc. are correct" / "Making
// sure ___ is clean"), và nối liền thì đọc thành một câu vô nghĩa.
//
// Phân biệt bằng chính dữ liệu: mẩu nối liền để gap TRẦN `{q_num}` và lấy chữ
// đứng trước làm phần dẫn; còn ý độc lập thì gap TỰ MANG `prefix` của nó. Nên:
// gap có `prefix` ⇒ mở dòng mới; mọi thứ khác ⇒ nối tiếp dòng đang mở.
// (Codex review PR #895)
function cellLines(segments) {
  const lines = [];
  let cur = null;
  let prev = null;
  segments.forEach((seg) => {
    const isGap = seg && typeof seg === 'object' && seg.q_num != null;
    // (a) Chỗ trống TỰ MANG phần dẫn ⇒ nó bắt đầu một ý mới.
    const ownsItsLead = isGap && String(seg.prefix || '').trim();
    // (b) Chữ đứng sau một chỗ trống ĐÃ CÓ phần đuôi ⇒ dòng kia đã trọn nghĩa,
    //     nên chữ này mở ý mới ("Starting salary £ ___ per hour" / "Start work
    //     at 5.30 a.m."). Thiếu vế này thì hai ý vẫn dính (soi lại trên prod
    //     sau PR #895).
    const followsClosedGap = !isGap && prev && typeof prev === 'object'
      && prev.q_num != null && String(prev.suffix || '').trim();
    if (cur === null || ownsItsLead || followsClosedGap) {
      cur = [];
      lines.push(cur);
    }
    cur.push(seg);
    prev = seg;
  });
  return lines;
}


function renderTableCompletion(tmpl, questions) {
  const heading = tmpl.heading || '';
  const headers = Array.isArray(tmpl.headers) ? tmpl.headers : [];
  const rows    = Array.isArray(tmpl.rows)    ? tmpl.rows    : [];
  if (!headers.length || !rows.length) return renderFallback(questions);
  return `
    <div class="ielts-table-container">
      ${heading ? `<div class="ielts-table-heading">${mdInline(heading)}</div>` : ''}
      <table class="ielts-table">
        <thead>
          <tr>${headers.map((h) => `<th>${mdInline(h)}</th>`).join('')}</tr>
        </thead>
        <tbody>
          ${rows.map((row) => `<tr>${row.map((c) => {
            if (Array.isArray(c)) {
              return `<td>${cellLines(c).map((line) =>
                `<div class="ielts-table-line">${line.map(tableGapSegment).join(' ')}</div>`
              ).join('')}</td>`;
            }
            if (c && typeof c === 'object' && c.q_num != null) {
              return `<td>${tableGapSegment(c)}</td>`;
            }
            return `<td>${mdInline(c == null ? '' : c)}</td>`;
          }).join('')}</tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
}


// ── Notes completion ────────────────────────────────────────────────

function renderNotesCompletion(tmpl, questions) {
  const heading = tmpl.heading || '';
  const groups = Array.isArray(tmpl.groups) ? tmpl.groups : [];
  if (!groups.length) return renderFallback(questions);
  return `
    <div class="ielts-notes-container">
      ${heading ? `<div class="ielts-notes-heading">${mdInline(heading)}</div>` : ''}
      ${groups.map((g) => `
        <div class="ielts-notes-group">
          ${g.heading
            ? `<div class="ielts-notes-group-heading">${mdInline(g.heading)}</div>`
            : ''}
          <ul class="ielts-notes-list">
            ${(g.items || []).map((it) => {
              if (it && typeof it === 'object' && it.q_num != null) {
                return `<li>
                  ${mdInline(it.prefix || '')}
                  <span class="ielts-question-num">${esc(it.q_num)}</span>
                  ${gapInput(it.q_num)}
                  ${it.suffix ? ' ' + mdInline(it.suffix) : ''}
                </li>`;
              }
              return `<li>${mdInline((it && it.text) || '')}</li>`;
            }).join('')}
          </ul>
        </div>
      `).join('')}
    </div>
  `;
}


// ── Summary completion (inline-gap paragraph) ──────────────────────

function renderSummaryCompletion(tmpl, questions) {
  const paragraph = tmpl.paragraph || '';
  if (!paragraph) return renderFallback(questions);
  // Split on `{{QN}}` tokens and interleave gap inputs.
  const parts = String(paragraph).split(/(\{\{Q\d+\}\})/);
  const rendered = parts.map((p) => {
    const m = /^\{\{Q(\d+)\}\}$/.exec(p);
    if (m) {
      const n = Number(m[1]);
      return `<span class="ielts-question-num">${esc(n)}</span>${gapInput(n)}`;
    }
    return mdInline(p);
  }).join('');
  return `<div class="ielts-summary-paragraph">${rendered}</div>`;
}


// ── Sentence completion ────────────────────────────────────────────

function renderSentenceCompletion(tmpl, questions) {
  const sentences = Array.isArray(tmpl.sentences) ? tmpl.sentences : [];
  if (!sentences.length) return renderFallback(questions);
  return sentences.map((s) => `
    <div class="ielts-sentence-row">
      <span class="ielts-question-num">${esc(s.q_num)}</span>
      <span>${mdInline(s.prefix || '')}</span>
      ${gapInput(s.q_num)}
      <span>${mdInline(s.suffix || '')}</span>
    </div>
  `).join('');
}


// ── Short answer ───────────────────────────────────────────────────

function renderShortAnswer(questions) {
  return questions.map((q) => `
    <div class="ielts-short-row">
      <span class="ielts-question-num">${esc(q.q_num)}</span>
      <span>${mdInline(q.prompt || '')}</span>
      ${gapInput(q.q_num)}
    </div>
  `).join('');
}


// ── MCQ ────────────────────────────────────────────────────────────

function renderMCQ(questions) {
  // Sprint 13.5.8 — radio / letter / option-text each in their own
  // slot (was: letter + text bundled in a single <span>) so CSS can
  // align them on the same baseline with a fixed inline gap.
  return questions.map((q) => {
    // Het-block: an MCQ-typed block can hold a non-MCQ item (a short-answer
    // with no A/B/C options, e.g. L02 Q4 under one "Choose the correct letter"
    // heading). Render a text gap, never an empty radio group. The backend
    // re-types it to short_answer; here we key off options presence so the
    // gap uses the same .ft-q-input/data-q-num contract the harness collects.
    if (!Array.isArray(q.options) || !q.options.length) {
      return `
    <div class="ielts-mcq-question">
      <div class="ielts-mcq-stem">
        <span class="ielts-question-num">${esc(q.q_num)}</span>
        ${mdInline(q.prompt || '')}
      </div>
      ${gapInput(q.q_num)}
    </div>`;
    }
    return `
    <div class="ielts-mcq-question">
      <div class="ielts-mcq-stem">
        <span class="ielts-question-num">${esc(q.q_num)}</span>
        ${mdInline(q.prompt || '')}
      </div>
      <div class="ielts-mcq-options">
        ${(q.options || []).map((o) => {
          const letter = o.letter || o.label || '';
          const text   = o.text   || '';
          return `<label class="ielts-mcq-option">
            <input type="radio" name="q-${esc(q.q_num)}" value="${esc(letter)}"
                   class="ft-q-input" data-q-num="${esc(q.q_num)}" />
            <strong>${esc(letter)}</strong>
            <span class="ielts-mcq-option-text">${mdInline(text)}</span>
          </label>`;
        }).join('')}
      </div>
    </div>`;
  }).join('');
}


// ── Plan / map labelling ───────────────────────────────────────────

function renderPlanLabel(payload, questions) {
  // Sprint 13.5.6 — accept the full payload so we can read both
  // metadata-level fields (letter_options) and the top-level
  // map_image_url that the student endpoint injects.
  // Sprint 13.5.8 — map_description is intentionally NOT read here:
  // real Cambridge plan-label tasks present a visual map only, so
  // the textual description (an admin-only AI-prompt input) must not
  // leak to the student. Backend strips it defensively, and the
  // renderer no longer references it.
  const meta = (payload && payload.metadata) || {};
  const mapImage = (payload && payload.map_image_url) || '';
  // Skill drills ship the plan as an inline <svg> string (admin-curated asset,
  // not user input) instead of a generated PNG — render it directly so the
  // Cambridge-style visual map appears with no image-generation pipeline.
  const mapSvg = (payload && payload.map_svg) || '';
  const letters = Array.isArray(meta.letter_options) && meta.letter_options.length
    ? meta.letter_options
    : (Array.isArray(payload.letter_options) && payload.letter_options.length
      ? payload.letter_options
      : ['A','B','C','D','E','F','G','H']);
  // Sprint 13.5.8 — image-only visual block. When no image exists,
  // render an admin-action notice instead of the description; the
  // exercise stays answerable (the dropdowns still work), but the
  // student is told a map is missing rather than handed the answer
  // key in prose.
  const visualBlock = mapSvg
    // Render the inline SVG as a data-URL <img>, NOT via innerHTML: an SVG
    // loaded through <img> runs in the browser's secure static mode (no
    // scripts, no external fetches), so a scriptable payload in an uploaded
    // Source JSON can't execute in the student's authenticated session.
    // encodeURIComponent also escapes '#'/'<'/'"' so the SVG can't break out
    // of the src attribute.
    ? `<div class="ielts-plan-image">
         <img src="${esc('data:image/svg+xml;utf8,' + encodeURIComponent(mapSvg))}"
              alt="Floor plan map" class="ielts-map-rendered ielts-map-svg" />
       </div>`
    : mapImage
    ? `<div class="ielts-plan-image">
         <img src="${esc(mapImage)}" alt="Floor plan map" class="ielts-map-rendered" />
       </div>`
    : `<div class="ielts-plan-no-image">
         <p class="ielts-notice">Hình map chưa được tạo cho exercise này.</p>
       </div>`;
  return `
    <div class="ielts-plan-container">
      ${visualBlock}
      <div class="ielts-plan-labels">
        ${questions.map((q) => `
          <div class="ielts-plan-row">
            <span class="ielts-question-num">${esc(q.q_num)}</span>
            <span class="ielts-plan-name">${mdInline(q.prompt || '')}</span>
            <select class="ft-q-input ielts-gap-input" data-q-num="${esc(q.q_num)}">
              <option value="">—</option>
              ${letters.map((L) => `<option value="${esc(L)}">${esc(L)}</option>`).join('')}
            </select>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}


// ── Multi-select (A2, P4) — one checkbox group, N picks → N q-slots ──

function renderMultiSelect(payload, questions) {
  const meta = (payload && payload.metadata) || {};
  const opts = Array.isArray(meta.match_options) ? meta.match_options : [];
  const choose = Number(meta.choose) || questions.length || 2;
  const slots = questions.map((q) => q.q_num);
  const boxes = opts.map((o) => `
    <label class="ielts-mc-opt">
      <input type="checkbox" class="ft-mc-box" value="${esc(o.letter)}" />
      <span><strong>${esc(o.letter)}</strong> ${mdInline(o.text || '')}</span>
    </label>`).join('');
  // The group spans N q-slots; the N checked letters map to those slots
  // (any-order — the grader scores the set). data-q-num is intentionally absent
  // on the checkboxes (not 1:1 with a q_num); a dedicated handler assigns slots.
  return `
    <div class="ielts-mc-group" data-mm-slots="${esc(slots.join(','))}" data-mm-choose="${esc(choose)}">
      ${boxes}
    </div>
  `;
}


// ── Matching (A1, P3) — shared option bank + a letter dropdown per Q ──

function renderMatching(payload, questions) {
  const meta = (payload && payload.metadata) || {};
  const bank = Array.isArray(meta.match_options) ? meta.match_options : [];
  const letters = (Array.isArray(meta.letter_options) && meta.letter_options.length)
    ? meta.letter_options
    : (bank.length ? bank.map((o) => o.letter) : ['A','B','C','D','E','F','G']);
  const bankBlock = bank.length
    ? `<div class="ielts-match-bank">
         <ul class="ielts-match-bank__list">
           ${bank.map((o) => `<li><strong>${esc(o.letter)}</strong> ${mdInline(o.text || '')}</li>`).join('')}
         </ul>
       </div>`
    : '';
  return `
    <div class="ielts-matching">
      ${bankBlock}
      <div class="ielts-match-rows">
        ${questions.map((q) => `
          <div class="ielts-match-row">
            <span class="ielts-question-num">${esc(q.q_num)}</span>
            <span class="ielts-match-name">${mdInline(q.prompt || '')}</span>
            <select class="ft-q-input ielts-gap-input" data-q-num="${esc(q.q_num)}">
              <option value="">—</option>
              ${letters.map((L) => `<option value="${esc(L)}">${esc(L)}</option>`).join('')}
            </select>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}


// ── Fallback (unknown template_kind or missing template) ───────────

function renderFallback(questions) {
  return questions.map((q) => `
    <div class="ielts-short-row">
      <span class="ielts-question-num">${esc(q.q_num)}</span>
      <span class="ielts-gap-prompt">${renderGapPrompt(q.prompt, q.q_num)}</span>
    </div>
  `).join('');
}


// ── Shared input fragment ──────────────────────────────────────────

function gapInput(qNum) {
  return `<input type="text" class="ft-q-input ielts-gap-input"
                 data-q-num="${esc(qNum)}"
                 autocomplete="off" spellcheck="false" />`;
}


function attachQuestionHandlers() {
  const inputs = document.querySelectorAll('.ft-q-input');
  inputs.forEach((el) => {
    el.addEventListener('input',  () => onAnswerChange(el));
    el.addEventListener('change', () => onAnswerChange(el));
  });
  attachMultiSelectHandlers();
}

// A2 (P4) — a multi-select checkbox group: enforce the N-pick soft-lock and map
// the N checked letters onto the group's N q-slots (any-order; the grader scores
// the set). Each slot still flows through STATE.answers + the debounced save.
function attachMultiSelectHandlers() {
  document.querySelectorAll('.ielts-mc-group').forEach((grp) => {
    const slots = (grp.getAttribute('data-mm-slots') || '')
      .split(',').map(Number).filter(Number.isFinite);
    const choose = Number(grp.getAttribute('data-mm-choose')) || slots.length || 2;
    const boxes = Array.from(grp.querySelectorAll('.ft-mc-box'));
    grp.addEventListener('change', () => {
      const checked = boxes.filter((b) => b.checked).map((b) => b.value);
      const lock = checked.length >= choose;          // soft-lock at N
      boxes.forEach((b) => { if (!b.checked) b.disabled = lock; });
      slots.forEach((slot, i) => {
        const v = checked[i];
        if (v == null) STATE.answers.delete(slot);
        else STATE.answers.set(slot, v);
        scheduleAutoSave(slot, v == null ? '' : v);
      });
      updateAnsweredCount();
    });
  });
}

function onAnswerChange(el) {
  const qNum = Number(el.getAttribute('data-q-num'));
  if (!Number.isFinite(qNum) || qNum < 1 || qNum > (STATE.totalQuestions || 40)) return;
  const val = (el.type === 'radio')
    ? (el.checked ? el.value : null)
    : el.value;
  if (val == null || val === '') {
    STATE.answers.delete(qNum);
  } else {
    STATE.answers.set(qNum, val);
  }
  updateAnsweredCount();
  scheduleAutoSave(qNum, val);
}

function updateAnsweredCount() {
  const n = STATE.answers.size;
  const a = $('ft-answered');
  const b = $('ft-answered-foot');
  if (a) a.textContent = String(n);
  if (b) b.textContent = String(n);
  // Sprint 13.5.5 — paint progress squares + per-tab counts.
  updateProgressTrackerSquares();
  updateTabProgressCounts();
}

function updateProgressTrackerSquares() {
  document.querySelectorAll('#ft-progress-bar .progress-square').forEach((sq) => {
    const q = Number(sq.getAttribute('data-q-num'));
    sq.classList.toggle('answered', STATE.answers.has(q));
  });
}

function updateTabProgressCounts() {
  const perSection = {};
  for (const qNum of STATE.answers.keys()) {
    const s = sectionForQ(qNum);
    if (s) perSection[s] = (perSection[s] || 0) + 1;
  }
  const sectionNums = Object.keys(STATE.sectionQCounts).map(Number);
  for (const s of (sectionNums.length ? sectionNums : [1, 2, 3, 4])) {
    const el = document.querySelector(`[data-tab-progress="${s}"]`);
    if (el) el.textContent = `${perSection[s] || 0}/${STATE.sectionQCounts[s] || 10}`;
  }
}


// ── Debounced auto-save (A4a) ────────────────────────────────────────
//
// This used to drop answers three ways, all silently:
//   · a save arriving while that question was already in flight RETURNED,
//     discarding the newer value with nothing scheduled to send it;
//   · errors were swallowed ("Silent — user can re-edit"), so a failed save
//     looked identical to a successful one and was never retried;
//   · the 2s debounce made the loss window 4× Reading's.
//
// Reading solved all of this in DEBT-2026-07-22-D / review #820. This ports the
// same mechanism: retry what a retry can fix, make an unsaved answer visible,
// and never let a newer value be beaten by an older one.
const SAVE_DEBOUNCE_MS = 500;
const SAVE_RETRY_DELAYS = [400, 1200, 3000];

// ONE answer PATCH at a time for the WHOLE attempt.
//
// The in-flight guard in saveAnswer() is per QUESTION, so it does nothing about
// two different questions writing at once — and a transient outage fails
// several saves together, each arming its own backoff timer. Making
// retryFailedSaves() sequential fixed only the manual/online path; the
// timer-driven retries still overlapped. That matters because the endpoint
// read-modify-writes the whole `answers` array, so concurrent writers overwrite
// one another while every response reports success and clears its own warning —
// the submitted test then silently omits answers (Codex review, PR #837).
//
// Serialising here is the client half of the fix; PR #838 makes the write
// itself atomic server-side. Both are worth having: the queue also stops two
// requests for the SAME question crossing on the wire.
let _patchChain = Promise.resolve();
const PATCH_QUEUE_MAX_WAIT_MS = 15000;

function enqueuePatch(fn) {
  // The timeout must ABORT, not merely stop waiting. Advancing the chain while
  // the old request is still open re-creates exactly what the queue exists to
  // prevent: the endpoint read-modify-writes the whole `answers` array, so a
  // slow PATCH finishing LAST can overwrite answers saved by the requests that
  // overtook it — while every call reports success (Codex review, PR #837).
  const ctrl = (typeof AbortController === 'function') ? new AbortController() : null;
  const run = _patchChain.then(() => fn(ctrl && ctrl.signal),
                               () => fn(ctrl && ctrl.signal));
  let timer = null;
  const bounded = new Promise((resolve) => {
    timer = setTimeout(() => {
      // A hung request must never wedge every later save — but it must be dead
      // before the next one starts.
      if (ctrl) { try { ctrl.abort(); } catch (e) { /* already settled */ } }
      resolve();
    }, PATCH_QUEUE_MAX_WAIT_MS);
  });
  _patchChain = Promise.race([
    run.then(() => {}, () => {}).then(() => { if (timer) clearTimeout(timer); }),
    bounded,
  ]);
  return run;
}

// Retry only what a retry can fix. No `status` → the request never produced a
// response (offline, DNS, dropped connection). `status >= 500` → server or
// gateway. A 4xx is deterministic — 401/403 (access), 404 (attempt gone), 422
// (bad body) all repeat identically — so it fails fast and shows the cue.
function isRetriableSaveError(e) {
  if (!e) return false;
  const status = e.status;
  if (status === undefined || status === null) return true;
  return Number(status) >= 500;
}

// 'retrying' | 'failed' | null. Two states, not one: after a non-retriable 4xx
// or a spent budget nothing is retrying, and telling the student to "wait" for
// a warning that can never clear by itself is worse than saying it stopped.
function setSaveState(qNum, state) {
  if (state) STATE.unsaved.set(qNum, state);
  else STATE.unsaved.delete(qNum);
  const sq = document.querySelector(`#ft-progress-bar .progress-square[data-q-num="${qNum}"]`);
  if (sq) {
    sq.classList.toggle('is-unsaved', !!state);
    sq.classList.toggle('is-save-failed', state === 'failed');
    if (state) {
      sq.setAttribute('title', state === 'failed'
        ? `Câu ${qNum} — chưa lưu được, đã ngừng thử lại`
        : `Câu ${qNum} — chưa lưu được, đang thử lại`);
    } else {
      sq.setAttribute('title', `Câu ${qNum} — Section ${sectionForQ(qNum)}`);
    }
  }
  renderUnsavedNote();
}

// One honest line above the submit button. A single amber square among 40 is
// easy to miss; this says how many answers the server does not have and what
// that means for closing the tab.
function renderUnsavedNote() {
  const note = $('ft-unsaved-note');
  if (!note) return;
  let retrying = 0, failed = 0;
  STATE.unsaved.forEach((s) => { if (s === 'failed') failed++; else retrying++; });
  if (!retrying && !failed) { note.hidden = true; note.textContent = ''; return; }
  note.hidden = false;
  note.textContent = '';
  const parts = [];
  if (retrying) parts.push(`Đang thử lưu lại ${retrying} câu.`);
  if (failed) parts.push(`${failed} câu chưa lưu được lên máy chủ và đã NGỪNG thử lại.`);
  parts.push(failed
    ? 'Đừng đóng tab: bấm «Thử lại», hoặc sửa lại chính câu đó, trước khi nộp.'
    : 'Đừng đóng tab cho tới khi hết cảnh báo này.');
  note.appendChild(document.createTextNode(parts.join(' ')));
  if (failed) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ft-unsaved-retry';
    btn.textContent = 'Thử lại';
    btn.addEventListener('click', retryFailedSaves);
    note.appendChild(document.createTextNode(' '));
    note.appendChild(btn);
  }
}

// How long after the FIRST save attempt we conclude that nothing is landing.
// The retry ladder is 400+1200+3000ms and the debounce is 500ms, so a healthy
// first save has resolved many times over by then; anything longer starts
// eating the exam the warning exists to save.
const NOTHING_SAVED_AFTER_MS = 45000;

// The alarm the per-question cue cannot raise: not "this answer failed" but
// "the server has NONE of your work". Deliberately louder and separately
// hosted — a student who ignores an amber square must not be able to ignore
// this one, because the alternative is a graded zero (prod, 2026-07-26).
function renderNothingSavedAlarm() {
  const box = $('ft-nothing-saved');
  if (!box) return;
  const tried = STATE.triedSaveAt !== null;
  const overdue = tried && (Date.now() - STATE.triedSaveAt) >= NOTHING_SAVED_AFTER_MS;
  // Only ever fires when the student is demonstrably WORKING and the server has
  // nothing. Never for someone who simply has not answered yet — that is the
  // normal opening minutes of a section, not a fault.
  if (STATE.serverHasOne || !overdue || STATE.submitting) {
    box.hidden = true;
    return;
  }
  reportNothingSaved();
  if (!box.hidden) return;                    // already up; don't rebuild
  box.hidden = false;
  box.textContent = '';
  box.appendChild(document.createTextNode(
    '⚠ MÁY CHỦ CHƯA NHẬN ĐƯỢC CÂU TRẢ LỜI NÀO của bạn. Nếu để nguyên, bài này '
    + 'sẽ bị chấm 0. BÁO GIÁM THỊ NGAY và đừng đóng tab.'));
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ft-unsaved-retry';
  btn.textContent = 'Gửi lại toàn bộ';
  btn.addEventListener('click', resendEverything);
  box.appendChild(document.createTextNode(' '));
  box.appendChild(btn);
}

// A warning with no remedy just tells the student something they cannot fix.
// Re-sends every answer held locally, oldest question first.
function resendEverything() {
  const qs = Array.from(STATE.answers.keys()).sort((a, b) => a - b);
  for (const qNum of qs) void saveAnswer(qNum, STATE.answers.get(qNum));
}


// Tell the SERVER, over the one channel still known to work.
//
// The failure this fires on can be a blocked PATCH — and a request the browser
// refuses to send leaves NO trace server-side. That is why a student sat two
// full sections graded 0 while every dashboard looked healthy (2026-07-26).
// /api/error-logs is a POST and takes optional auth, so it survives exactly the
// conditions that kill the answer saves. Plain fetch, never window.api: a 401
// there would redirect a student out of a live exam.
function reportNothingSaved() {
  if (STATE.nothingReported) return;      // once per attempt, not per tick
  STATE.nothingReported = true;
  try {
    window.fetch(window.api.base + '/api/error-logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        level: 'error',
        source: 'frontend',
        message: 'MOCK/LISTENING: no answer save has reached the server',
        url: location.pathname + location.search,
        user_agent: navigator.userAgent,
        extra: {
          attempt_id: STATE.attemptId,
          answers_held_locally: STATE.answers.size,
          seconds_since_first_try: Math.round((Date.now() - STATE.triedSaveAt) / 1000),
        },
      }),
    }).catch(function () {});               // logging must never escalate
  } catch (e) { /* swallow */ }
}

function startNothingSavedWatch() {
  if (STATE.nothingTimer) return;
  STATE.nothingTimer = setInterval(renderNothingSavedAlarm, 10000);
}

// Manual + automatic escape hatch out of the terminal state. Coming back online
// is by far the commonest reason a given-up save would now succeed.
async function retryFailedSaves() {
  const due = [];
  STATE.unsaved.forEach((state, qNum) => { if (state === 'failed') due.push(qNum); });
  // SEQUENTIALLY. Coming back online typically releases several failed answers
  // at once, and until the atomic RPC lands the backend reads and rewrites the
  // WHOLE answers array per request — so firing them together lets each one
  // overwrite the others while every response still reports success and clears
  // its own warning (Codex review, PR #837).
  for (const qNum of due) {
    await saveAnswer(qNum, STATE.answers.get(qNum)).catch(() => {});
  }
}

// Drain every pending save before finalising, INCLUDING ones that had to be
// re-queued behind an in-flight request.
//
// saveAnswer() returns immediately when the same question is already on the
// wire — it re-arms the debounce with the newer value. A caller that simply
// awaited the returned promise therefore proceeded to submit while the latest
// answer was still only scheduled; the delayed PATCH then hit a finalised
// attempt and was rejected, so grading used the PREVIOUS answer (Codex review,
// PR #837).
//
// Loop until nothing is queued and nothing is in flight, bounded so a
// permanently failing save can never wedge submission.
function failedAnswerNumbers() {
  const out = [];
  STATE.unsaved.forEach((state, qNum) => { if (state === 'failed') out.push(qNum); });
  return out;
}

// Returns TRUE when the server holds everything, FALSE when at least one answer
// is still unsaved after the drain. The caller decides what to do with that —
// see confirmSubmit / the mock-flush handler.
async function flushAllPendingSaves(maxRounds = 6) {
  for (let round = 0; round < maxRounds; round++) {
    const due = Array.from(STATE.saveTimers.keys());
    for (const q of due) {
      clearTimeout(STATE.saveTimers.get(q));
      STATE.saveTimers.delete(q);
      // Read the CURRENT value, not one captured before the wait.
      await saveAnswer(q, STATE.answers.get(q)).catch(() => {});
    }
    // Answers whose retry ladder is EXHAUSTED sit in `unsaved` as 'failed' with
    // no timer and nothing in flight, so the old emptiness test called the queue
    // drained and finalisation went ahead without them — permanently grading a
    // paper that is missing answers the student gave (Codex review, PR #837).
    // One more attempt per round, since the outage may well be over by now.
    const failed = failedAnswerNumbers();
    for (const q of failed) {
      await saveAnswer(q, STATE.answers.get(q)).catch(() => {});
    }
    // A transiently-failed PATCH leaves NO debounce timer and nothing in
    // flight — only a saveRetryTimers entry. Ignoring those meant the drain
    // returned immediately, confirmSubmit finalised the attempt, and the
    // delayed retry was rejected with 422, so grading permanently omitted that
    // answer (Codex review, PR #837).
    if (!STATE.saveTimers.size && !STATE.inflight.size
        && !STATE.saveRetryTimers.size && !failedAnswerNumbers().length) return true;
    // Pull any waiting retry forward rather than sleeping out its backoff.
    for (const q of Array.from(STATE.saveRetryTimers.keys())) {
      clearTimeout(STATE.saveRetryTimers.get(q));
      STATE.saveRetryTimers.delete(q);
      await saveAnswer(q, STATE.answers.get(q)).catch(() => {});
    }
    // Give the in-flight request a moment to settle so its re-queued
    // successor becomes visible on the next round.
    await new Promise((r) => setTimeout(r, 150));
  }
  return !failedAnswerNumbers().length
    && !STATE.saveTimers.size && !STATE.inflight.size && !STATE.saveRetryTimers.size;
}

function scheduleAutoSave(qNum, value) {
  if (STATE.saveTimers.has(qNum)) {
    clearTimeout(STATE.saveTimers.get(qNum));
  }
  const handle = setTimeout(() => {
    STATE.saveTimers.delete(qNum);
    void saveAnswer(qNum, value);
  }, SAVE_DEBOUNCE_MS);
  STATE.saveTimers.set(qNum, handle);
}

async function saveAnswer(qNum, value, opts) {
  if (!STATE.attemptId) return;
  const attempt = (opts && opts.attempt) || 0;

  // A fresh edit supersedes any retry chain still waiting for this question —
  // otherwise the pending retry fires a second PATCH right behind the new one.
  if (!attempt && STATE.saveRetryTimers.has(qNum)) {
    clearTimeout(STATE.saveRetryTimers.get(qNum));
    STATE.saveRetryTimers.delete(qNum);
  }

  // One generation per logical save. A fresh edit bumps it; retries inherit
  // theirs. Without this two overlapping PATCHes race: the newer fails and
  // raises the cue, the older then resolves and clears it — telling the student
  // the latest answer is safe when the server only holds the previous one.
  let gen = opts && opts.gen;
  if (gen === undefined) {
    gen = (STATE.saveGen.get(qNum) || 0) + 1;
    STATE.saveGen.set(qNum, gen);
  }

  // Already in flight for this question: do NOT drop the new value (the old bug
  // — it was discarded with nothing scheduled to send it). Re-arm the debounce
  // so the latest text goes out as soon as the current request settles.
  if (STATE.inflight.has(qNum)) {
    scheduleAutoSave(qNum, value);
    return;
  }

  if (STATE.triedSaveAt === null) STATE.triedSaveAt = Date.now();
  STATE.inflight.add(qNum);
  try {
    await enqueuePatch((signal) => window.api.patchWith(
      `/api/listening/tests/attempts/${encodeURIComponent(STATE.attemptId)}/answers`,
      { q_num: qNum, user_answer: value == null ? '' : String(value) },
      null, { signal: signal },
    ));
    STATE.serverHasOne = true;      // proof the pipe works at least once
    renderNothingSavedAlarm();
    if (gen === STATE.saveGen.get(qNum)) {
      setSaveState(qNum, null);
      const el = document.querySelector(`.ft-q-input[data-q-num="${qNum}"]`);
      if (el && el.type !== 'radio') el.classList.add('saved');
    }
  } catch (e) {
    if (gen !== STATE.saveGen.get(qNum)) return;   // superseded; its own chain owns the cue
    if (isRetriableSaveError(e) && attempt < SAVE_RETRY_DELAYS.length) {
      setSaveState(qNum, 'retrying');
      const handle = setTimeout(() => {
        STATE.saveRetryTimers.delete(qNum);
        // Re-read the CURRENT answer rather than replaying the value captured
        // when this chain started. An edit made during the backoff only arms
        // its own 500ms debounce and does not cancel this retry, so replaying
        // the capture would PATCH stale text, then clear the unsaved cue —
        // telling the student the newest answer is safe while the server holds
        // the older one (Codex review, PR #837).
        const current = STATE.answers.has(qNum) ? STATE.answers.get(qNum) : value;
        void saveAnswer(qNum, current, { attempt: attempt + 1, gen });
      }, SAVE_RETRY_DELAYS[attempt]);
      STATE.saveRetryTimers.set(qNum, handle);
    } else {
      setSaveState(qNum, 'failed');
    }
  } finally {
    STATE.inflight.delete(qNum);
  }
}


// ── Audio control ────────────────────────────────────────────────────
// Full test: single-shot Play (Cambridge exam — no pause/seek/restart).
// Mini + drill (practice): play/pause + drag-to-seek + replay.

function mountAudio() {
  const audio = new Audio();
  audio.src         = STATE.test.audio_url;
  audio.preload     = 'auto';
  audio.crossOrigin = 'anonymous';
  STATE.audio = audio;

  // Practice modes (mini + drill + practice) relax the single-shot constraint
  // so the learner can pause, drag the progress bar to seek, and replay.
  // Full tests keep the exam-authentic no-seek behaviour. Legacy full
  // tests may report test_type === null → treated as full.
  //
  // `practice` belongs here and not with `full`: a 40-second trap drill whose
  // whole point is hearing the trap again would be unusable under exam rules,
  // and resume-by-started_at would skip past the audio entirely.
  STATE.scrub = isPracticeTest(STATE.test);

  // Sprint 13.5.5 — index cue points by tab so timeupdate can lazily
  // check whether to auto-advance the active tab (Cambridge-style:
  // when the audio enters Section N, the question paper auto-switches
  // to PART N).
  STATE.cuePointsByTab = new Map();
  const cuePoints = Array.isArray(STATE.test && STATE.test.cue_points)
    ? STATE.test.cue_points : [];
  for (const cue of cuePoints) {
    if (cue && cue.type === 'section_start'
        && Number.isFinite(cue.section_num)
        && Number.isFinite(cue.timestamp_seconds)) {
      // Keep the EARLIEST cue per tab in case a section has multiple.
      const prev = STATE.cuePointsByTab.get(cue.section_num);
      if (prev == null || cue.timestamp_seconds < prev) {
        STATE.cuePointsByTab.set(cue.section_num, cue.timestamp_seconds);
      }
    }
  }

  audio.addEventListener('loadedmetadata', () => {
    $('ft-total-time').textContent = fmtTime(audio.duration);
  });
  audio.addEventListener('timeupdate', () => {
    $('ft-current-time').textContent = fmtTime(audio.currentTime);
    const pct = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
    $('ft-audio-fill').style.width = `${pct}%`;
    maybeAutoAdvanceTab(audio.currentTime);
  });
  audio.addEventListener('ended', () => {
    const btn = $('btn-playpause');
    if (!btn) return;
    if (STATE.scrub) {
      // Practice (mini + drill) — allow replay from the start.
      STATE.playbackStarted = false;
      btn.textContent = '▶ Nghe lại';
      btn.disabled = false;
    } else {
      // Sprint 13.5.7 — audio ended; button stays disabled and reflects
      // the terminal state. No replay button — matches real Cambridge
      // exam where the recording plays through exactly once.
      btn.textContent = 'Đã hết';
      btn.disabled = true;
    }
  });

  $('btn-playpause').addEventListener(
    'click', STATE.scrub ? togglePlayback : startPlayback,
  );
  $('ft-volume').addEventListener('input', (e) => {
    // Volume adjustment stays — Cambridge real exam allows it.
    audio.volume = Number(e.target.value) / 100;
  });
  if (STATE.scrub) wireSeekBar(audio);
  $('btn-submit').addEventListener('click', confirmSubmit);
}

// Sprint 13.5.7 — Cambridge IELTS audio convention: single-shot Play.
// Once the student starts the audio, the button locks and the audio
// plays through to the end. No pause, no restart, no speed control.
// The button stays visible (disabled) so the student has visual
// feedback that playback is underway.
function startPlayback() {
  const a = STATE.audio;
  if (!a) return;
  if (STATE.playbackStarted) return;     // No-op on subsequent clicks.
  STATE.playbackStarted = true;
  a.playbackRate = 1.0;                  // Lock native playback speed.
  const playPromise = a.play();
  const btn = $('btn-playpause');
  if (btn) {
    btn.textContent = 'Đang phát';
    btn.disabled = true;
  }
  // Older browsers (Safari) may reject if the gesture chain broke;
  // surface that gracefully and re-enable so the student can retry.
  if (playPromise && typeof playPromise.catch === 'function') {
    playPromise.catch(() => {
      STATE.playbackStarted = false;
      if (btn) {
        btn.textContent = '▶ Play';
        btn.disabled = false;
      }
    });
  }
}

// Practice (mini + drill) — play/pause toggle. Unlike startPlayback the
// button never locks, so the learner can pause and resume freely.
function togglePlayback() {
  const a = STATE.audio;
  if (!a) return;
  const btn = $('btn-playpause');
  if (a.paused) {
    a.playbackRate = 1.0;
    STATE.playbackStarted = true;
    const p = a.play();
    if (btn) btn.textContent = '⏸ Tạm dừng';
    if (p && typeof p.catch === 'function') {
      p.catch(() => { if (btn) btn.textContent = '▶ Play'; });
    }
  } else {
    a.pause();
    if (btn) btn.textContent = '▶ Tiếp tục';
  }
}

// Practice (mini + drill) — drag/click the progress bar to seek.
function wireSeekBar(audio) {
  const bar = document.querySelector('.ft-audio-bar');
  if (!bar) return;
  bar.classList.add('ft-audio-bar--seekable');
  bar.setAttribute('aria-label', 'Audio progress (kéo để tua)');
  const seekToClientX = (clientX) => {
    const rect = bar.getBoundingClientRect();
    if (!rect.width || !Number.isFinite(audio.duration)) return;
    let pct = (clientX - rect.left) / rect.width;
    pct = Math.min(1, Math.max(0, pct));
    audio.currentTime = pct * audio.duration;
    $('ft-audio-fill').style.width = `${pct * 100}%`;
  };
  let dragging = false;
  bar.addEventListener('pointerdown', (e) => {
    dragging = true;
    try { bar.setPointerCapture(e.pointerId); } catch { /* noop */ }
    seekToClientX(e.clientX);
  });
  bar.addEventListener('pointermove', (e) => {
    if (dragging) seekToClientX(e.clientX);
  });
  const endDrag = () => { dragging = false; };
  bar.addEventListener('pointerup', endDrag);
  bar.addEventListener('pointercancel', endDrag);
}


// ── Submit + result panel ────────────────────────────────────────────

async function confirmSubmit() {
  if (STATE.submitting) return;
  const answered = STATE.answers.size;
  const ok = window.confirm(
    `Nộp bài bây giờ? Bạn đã trả lời ${answered}/${STATE.totalQuestions || 40} câu. ` +
    'Sau khi nộp, bạn không thể chỉnh sửa đáp án.',
  );
  if (!ok) return;

  STATE.submitting = true;
  $('btn-submit').disabled = true;
  $('btn-submit').textContent = 'Đang chấm…';

  // Flush any pending debounced saves first — including ones re-queued behind
  // an in-flight request, which the old single pass walked straight past.
  const clean = await flushAllPendingSaves();
  if (!clean) {
    // Finalising now would permanently grade a paper missing answers the
    // student actually gave. A MANUAL submit can wait; hand the decision back
    // rather than taking it silently (Codex review, PR #837).
    const stuck = failedAnswerNumbers().sort((a, b) => a - b).join(', ');
    STATE.submitting = false;
    $('btn-submit').disabled = false;
    $('btn-submit').textContent = 'Nộp bài';
    renderUnsavedNote();
    window.alert(
      `Chưa lưu được đáp án câu ${stuck || '?'} lên máy chủ, nộp bây giờ sẽ mất ` +
      'những câu đó. Kiểm tra kết nối rồi bấm «Thử lại» ở cảnh báo phía trên, ' +
      'sau đó nộp lại.',
    );
    return;
  }

  try {
    const result = await window.api.post(
      `/api/listening/tests/attempts/${encodeURIComponent(STATE.attemptId)}/submit`,
      {},
    );
    if (STATE.audio) STATE.audio.pause();
    // Mock sitting: sealed submit returns {received:true} (no score). Embedded
    // (3-tab mock) → the parent finalises, stay quiet. Standalone → hand back.
    if (window.MockHook && MockHook.isSealedResponse(result)) {
      if (!(MockHook.embedded && MockHook.embedded())) MockHook.showSealedAndReturn('listening');
      return;
    }
    renderResult(result);
    showState('result');
  } catch (e) {
    STATE.submitting = false;
    $('btn-submit').disabled = false;
    $('btn-submit').textContent = 'Nộp bài';
    showError(`Không nộp được bài: ${(e && e.message) || e}`);
  }
}

function renderResult(result) {
  const score = result.score ?? 0;
  const max   = result.max_score ?? (STATE.totalQuestions || 40);
  $('res-score').textContent = `${score}/${max}`;
  $('res-band').textContent  = result.band_estimate != null
    ? Number(result.band_estimate).toFixed(1)
    : 'Dưới band 4';
  const pct = max > 0 ? Math.round((score / max) * 100) : 0;
  $('res-pct').textContent = `${pct}%`;

  // Section breakdown — one cell per ACTUAL section (a mini has just s1), not a
  // fixed s1..s4. Prefer the keys the grader returned; fall back to the test's
  // real section count.
  const sb = result.section_breakdown || {};
  const sbKeys = Object.keys(sb).length
    ? Object.keys(sb).sort()
    : Array.from({ length: STATE.sectionCount || 4 }, (_, i) => `s${i + 1}`);
  const sbRoot = $('res-sections');
  sbRoot.innerHTML = sbKeys.map((k) => {
    const cell = sb[k] || { correct: 0, total: 0 };
    return `<div class="ft-section-cell">
      ${esc(k.toUpperCase())}<br>
      <strong>${esc(cell.correct)}/${esc(cell.total)}</strong>
    </div>`;
  }).join('');

  // Trap analytics.
  const trap = result.trap_analytics || {};
  const trapKeys = Object.keys(trap);
  if (trapKeys.length) {
    $('res-trap-block').hidden = false;
    $('res-trap').innerHTML = trapKeys.map((k) => {
      const v = trap[k] || { caught: 0, missed: 0 };
      return `<div class="ft-trap-row">
        <span>${esc(k)}</span>
        <span>Bắt được: <strong>${esc(v.caught)}</strong> · Mắc bẫy: <strong>${esc(v.missed)}</strong></span>
      </div>`;
    }).join('');
  } else {
    $('res-trap-block').hidden = true;
  }

  // Per-question list.
  const perQ = Array.isArray(result.per_question) ? result.per_question : [];
  $('res-per-q').innerHTML = perQ.map((r) => {
    const cls = r.correct ? 'correct' : 'wrong';
    const userText = r.user_answer || '(bỏ trống)';
    return `
      <div class="ft-per-q-row ${cls}">
        <span class="ft-per-q-num">${esc(r.q_num)}</span>
        <span class="ft-per-q-user">${esc(userText)}</span>
        <span class="ft-per-q-expected">→ ${esc(r.expected)}</span>
      </div>
    `;
  }).join('');

  // listening-review-ui — point the chữa-bài CTA at this attempt's full-screen
  // review (transcript + per-question solution + 🔊 audio-window replay).
  // &from= carries the origin through: the review page is shared by both
  // libraries + the mock result, and would otherwise guess.
  const chuabai = $('res-chuabai');
  if (chuabai && STATE.attemptId) {
    chuabai.href = '/pages/listening-review.html?attempt_id=' + encodeURIComponent(STATE.attemptId)
      + '&from=' + originFromUrl();
  }

  // Dictation (chép chính tả) for the same test — reuses this test's
  // audio + section transcripts.
  const dictation = $('res-dictation');
  if (dictation && STATE.testId) {
    dictation.href =
      '/pages/listening-test-dictation.html?test_id=' + encodeURIComponent(STATE.testId);
  }
}


// ── Entry point ──────────────────────────────────────────────────────

function main() {
  wireBack();               // before the early return — the 'missing' state is
                            // itself a "pick one from the list" screen
  const id = getTestIdFromUrl();
  if (!id) {
    showState('missing');
    return;
  }
  $('btn-start').addEventListener('click', startAttempt);
  $('ft-resume-btn').addEventListener('click', resumeAttempt);
  void loadTest(id);
}

// 4-skill mock (mock_embed): the parent one-timer page asks this runner to
// FLUSH its debounced auto-saves before it submits the attempt, so a just-typed
// answer isn't stranded in the debounce queue.
window.addEventListener('message', async (ev) => {
  if (!ev.data || ev.data.type !== 'mock-flush') return;
  let clean = false;
  try {
    clean = await flushAllPendingSaves();
  } catch (e) { /* best-effort — the parent must not hang on our failure */ }
  // Report the truth. The mock parent CANNOT be blocked — the section clock has
  // hit zero and the server force-collects regardless, so refusing to answer
  // would only strand the student at 00:00. But it must not be told the paper
  // is clean when it is not: `unsaved` rides along so the runner can surface it
  // and the invigilator sees a real signal (Codex review, PR #837).
  if (ev.source) {
    ev.source.postMessage({
      type: 'mock-flushed', section: 'listening',
      unsaved: clean ? 0 : failedAnswerNumbers().length,
    }, '*');
  }
});

// A4a — the retry budget is spent while offline far more often than for any
// other reason, so regaining connectivity retries the given-up saves without
// the student having to notice the button.
window.addEventListener('online', retryFailedSaves);

document.addEventListener('DOMContentLoaded', main);
