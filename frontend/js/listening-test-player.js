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
 *      (Cambridge constraint). Each answer change debounces 2s and
 *      PATCHes /api/listening/tests/attempts/{id}/answers.
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

async function startAttempt() {
  const ok = window.confirm(
    'Bắt đầu test? Audio sẽ phát ngay và không thể tua lại. ' +
    'Bài thi sẽ kết thúc khi bạn nộp bài hoặc audio chạy hết.',
  );
  if (!ok) return;

  $('btn-start').disabled = true;
  $('btn-start').textContent = 'Đang khởi tạo…';

  try {
    const res = await window.api.post(
      `/api/listening/tests/${encodeURIComponent(STATE.testId)}/attempts`,
      {},
    );
    STATE.attemptId = res.attempt_id;
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
  const parts = String(raw)
    .split(/(?<=\.)\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length <= 1) return `<p>${mdInline(raw)}</p>`;
  return parts.map((p) => `<p>${mdInline(p)}</p>`).join('');
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
          const label = `<span class="ielts-form-label">${mdInline(r.label || '')}:</span>`;
          if (r.example != null) {
            return `<div class="ielts-form-row">
              ${label}
              <span class="ielts-form-example">${mdInline(r.example)} (Example)</span>
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
              ${gapInput(r.q_num)}
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
            if (c && typeof c === 'object' && c.q_num != null) {
              return `<td>
                <span class="ielts-question-num">${esc(c.q_num)}</span>
                ${gapInput(c.q_num)}
              </td>`;
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
  const visualBlock = mapImage
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
      <p class="ielts-mc-hint">Chọn ${esc(choose)} đáp án (${esc(slots.join(' + '))}).</p>
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


// ── Debounced auto-save (2s per gap, last-write-wins) ────────────────

function scheduleAutoSave(qNum, value) {
  if (STATE.saveTimers.has(qNum)) {
    clearTimeout(STATE.saveTimers.get(qNum));
  }
  const handle = setTimeout(() => {
    STATE.saveTimers.delete(qNum);
    void saveAnswer(qNum, value);
  }, 2000);
  STATE.saveTimers.set(qNum, handle);
}

async function saveAnswer(qNum, value) {
  if (!STATE.attemptId) return;
  if (STATE.inflight.has(qNum)) return;
  STATE.inflight.add(qNum);
  try {
    await window.api.patch(
      `/api/listening/tests/attempts/${encodeURIComponent(STATE.attemptId)}/answers`,
      { q_num: qNum, user_answer: value == null ? '' : String(value) },
    );
    const el = document.querySelector(`.ft-q-input[data-q-num="${qNum}"]`);
    if (el && el.type !== 'radio') el.classList.add('saved');
  } catch (e) {
    // Silent — user can re-edit; UI does not need to block on save errors.
  } finally {
    STATE.inflight.delete(qNum);
  }
}


// ── Audio control (NO seek/rewind) ───────────────────────────────────

function mountAudio() {
  const audio = new Audio();
  audio.src         = STATE.test.audio_url;
  audio.preload     = 'auto';
  audio.crossOrigin = 'anonymous';
  STATE.audio = audio;

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
    // Sprint 13.5.7 — audio ended; button stays disabled and reflects
    // the terminal state. No replay button — matches real Cambridge
    // exam where the recording plays through exactly once.
    const btn = $('btn-playpause');
    if (btn) {
      btn.textContent = 'Đã hết';
      btn.disabled = true;
    }
  });

  $('btn-playpause').addEventListener('click', startPlayback);
  $('ft-volume').addEventListener('input', (e) => {
    // Volume adjustment stays — Cambridge real exam allows it.
    audio.volume = Number(e.target.value) / 100;
  });
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

  // Flush any pending debounced saves first.
  const pending = Array.from(STATE.saveTimers.keys());
  for (const q of pending) {
    clearTimeout(STATE.saveTimers.get(q));
    STATE.saveTimers.delete(q);
    await saveAnswer(q, STATE.answers.get(q));
  }

  try {
    const result = await window.api.post(
      `/api/listening/tests/attempts/${encodeURIComponent(STATE.attemptId)}/submit`,
      {},
    );
    if (STATE.audio) STATE.audio.pause();
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
  const chuabai = $('res-chuabai');
  if (chuabai && STATE.attemptId) {
    chuabai.href = '/pages/listening-review.html?attempt_id=' + encodeURIComponent(STATE.attemptId);
  }
}


// ── Entry point ──────────────────────────────────────────────────────

function main() {
  const id = getTestIdFromUrl();
  if (!id) {
    showState('missing');
    return;
  }
  $('btn-start').addEventListener('click', startAttempt);
  void loadTest(id);
}

document.addEventListener('DOMContentLoaded', main);
