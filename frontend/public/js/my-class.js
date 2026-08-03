/**
 * frontend/js/my-class.js — trang "Lớp của tôi" phía học viên (GĐ 3).
 *
 * Kế hoạch: docs/CLASS_MANAGEMENT_PLAN_2026-08-02.md
 *
 * The page answers one question: what do I owe, and when? So it groups by
 * URGENCY rather than by date — overdue first, then due, then a quiet history —
 * and gives the nearest unsubmitted deadline a live countdown.
 *
 * The countdown is the point. The centre gives one task a day due at 19:00, and
 * a student opening this at 18:20 needs "còn 40 phút", not "03/08/2026 19:00".
 * It counts down to the ABSOLUTE instant the server sent (an aware timestamp
 * built from 19:00 Asia/Ho_Chi_Minh), so a learner in another timezone sees the
 * same remaining time rather than a wrong local reading of the same clock face.
 *
 * Starting a task deliberately goes /start → POST /sessions rather than creating
 * the session here: POST /sessions owns quota, the daily cap and permissions,
 * and the class assignment entitles its own mode server-side.
 */

const api = window.api;
const $ = (id) => document.getElementById(id);

const esc = (s) => (typeof window !== 'undefined' && window.WC && window.WC.escapeHtml)
  ? window.WC.escapeHtml(s)
  : String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

let _data = null;
let _tick = null;
let _reloadingForDeadline = false;
// item_ids whose deadline refresh SUCCEEDED — see renderCountdown.
const _deadlineReloaded = new Set();
// item_id → earliest time we may retry a failed deadline refresh. Bounded on
// purpose: retrying every tick is what the previous fix was written to stop.
const _deadlineRetryAfter = new Map();
const DEADLINE_RETRY_MS = 15000;
// item_id of a start currently in flight — one attempt at a time.
let _startingItem = null;

// ── Formatting ──────────────────────────────────────────────────────────────

/** "còn 2 giờ 14 phút" / "còn 40 phút" / "còn 35 giây". */
function remainingLabel(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h} giờ ${String(m).padStart(2, '0')} phút`;
  if (m > 0) return `${m} phút ${String(s).padStart(2, '0')} giây`;
  return `${s} giây`;
}

function dueLabel(dueAt) {
  if (!dueAt) return 'Không có hạn nộp';
  const d = new Date(dueAt);
  if (Number.isNaN(d.getTime())) return 'Hạn nộp không đọc được';
  return 'Hạn ' + d.toLocaleString('vi-VN', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

function submittedLabel(row) {
  const d = new Date(row.submitted_at);
  const when = Number.isNaN(d.getTime()) ? '' : d.toLocaleString('vi-VN', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const band = row.score != null ? ` · <span class="mc-band">Band ${esc(row.score)}</span>` : '';
  return (row.is_late ? `Nộp trễ lúc ${esc(when)}` : `Đã nộp lúc ${esc(when)}`) + band;
}

function taskSub(a) {
  const cfg = a.assignment.content_config || {};
  return [cfg.topic, cfg.part ? `Part ${cfg.part}` : ''].filter(Boolean).join(' · ');
}

// ── Rendering ───────────────────────────────────────────────────────────────

function itemRow(a, { action }) {
  const sub = taskSub(a);
  const meta = a.submitted_at
    ? submittedLabel(a)
    : `${esc(dueLabel(a.assignment.due_at))}${a.is_missing ? ' · quá hạn' : ''}`;
  const btn = action
    ? `<button class="mc-btn${a.is_missing ? '' : ''}" data-action="start" data-item="${esc(a.item_id)}">Làm bài</button>`
    : '';
  return `<article class="mc-item${a.is_missing ? ' is-missing' : ''}">
    <div class="mc-item-main">
      <p class="mc-item-title">${esc(a.assignment.title)}</p>
      ${sub ? `<p class="mc-item-sub">${esc(sub)}</p>` : ''}
      <p class="mc-item-sub${a.is_missing ? ' is-alarm' : ''}">${meta}</p>
      ${a.assignment.instructions ? `<p class="mc-item-sub">${esc(a.assignment.instructions)}</p>` : ''}
    </div>
    ${btn}
  </article>`;
}

function renderGroup(groupId, listId, rows, opts) {
  $(groupId).hidden = rows.length === 0;
  if (rows.length) $(listId).innerHTML = rows.map((a) => itemRow(a, opts)).join('');
}

function renderStats(p) {
  if (!p) {
    // The assignments block failed. Showing zeros would claim the student owes
    // nothing, which is the one thing this page must never get wrong.
    $('mc-stats').innerHTML =
      '<div class="mc-stat"><div class="mc-stat-num">—</div>'
      + '<div class="mc-stat-label">Chưa đọc được bài tập</div></div>';
    return;
  }
  const cards = [
    { num: p.todo, label: 'Cần nộp' },
    { num: p.missing, label: 'Quá hạn', alarm: p.missing > 0 },
    { num: p.submitted, label: 'Đã nộp' },
    { num: p.on_time_pct == null ? '—' : p.on_time_pct + '%', label: 'Đúng hạn' },
  ];
  $('mc-stats').innerHTML = cards.map((c) => `
    <div class="mc-stat${c.alarm ? ' is-alarm' : ''}">
      <div class="mc-stat-num">${esc(c.num)}</div>
      <div class="mc-stat-label">${esc(c.label)}</div>
    </div>`).join('');
}

/**
 * Lesson bodies are Markdown by contract (class_lessons.body_md, mig 176), so
 * escaping them showed the student raw `**bold**` and unclickable links.
 *
 * Goes through the shared sanitised renderer — admin-authored text rendered in
 * another user's browser must never reach innerHTML un-sanitised. If either CDN
 * lib failed to load, window.renderMarkdown itself falls back to escaped
 * plaintext; the guard here covers the script not having arrived at all.
 */
/**
 * `class_lessons.lesson_date` is a Postgres DATE — a calendar day, not an
 * instant. `new Date('2026-08-03')` parses it as UTC midnight, so a learner at a
 * negative offset (America/Los_Angeles) saw 02/08 for a lesson held on the 3rd.
 * Split the string instead of asking Date to interpret it.
 */
/** Only http(s) links become clickable. Anything else renders as inert text. */
function isSafeUrl(url) {
  // An empty string resolves against the origin and would come back https —
  // clickable, and pointing at the app itself.
  if (!url || !String(url).trim()) return false;
  try {
    const u = new URL(String(url), window.location.origin);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

function calendarDate(value) {
  if (!value) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

function lessonBody(md) {
  if (typeof window.renderMarkdown === 'function') {
    return window.renderMarkdown(md, { breaks: true });
  }
  return `<p>${esc(md)}</p>`;
}

function renderLessons(lessons) {
  $('mc-group-lessons').hidden = lessons.length === 0;
  if (!lessons.length) return;
  $('mc-lessons').innerHTML = lessons.map((l) => {
    const no = l.lesson_no != null ? `Buổi ${esc(l.lesson_no)}` : '';
    const date = calendarDate(l.lesson_date);
    const files = (Array.isArray(l.attachments) ? l.attachments : [])
      .map((f) => {
        // Escaping stops attribute injection but says nothing about the SCHEME:
        // a `javascript:` href still runs on click. The backend rejects these at
        // the source (mig 176 contract), and this is the second lock.
        if (!isSafeUrl(f.url)) {
          return `<span class="mc-file" title="Đường dẫn không hợp lệ">${esc(f.label)}</span>`;
        }
        return `<a class="mc-file" href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">${esc(f.label)}</a>`;
      }).join('');
    return `<article class="mc-lesson">
      <div class="mc-lesson-no">${no}</div>
      <div class="mc-lesson-main">
        <p class="mc-lesson-title">${esc(l.title)}</p>
        ${date ? `<p class="mc-item-sub">${esc(date)}</p>` : ''}
        ${l.body_md ? `<div class="mc-lesson-body">${lessonBody(l.body_md)}</div>` : ''}
        ${files ? `<div class="mc-files">${files}</div>` : ''}
      </div>
    </article>`;
  }).join('');
}

// ── The countdown ───────────────────────────────────────────────────────────

/**
 * The nearest deadline still worth counting down to.
 *
 * `is_missing` comes from the server and is authoritative: it means the deadline
 * has passed with nothing submitted, and that work belongs under "Quá hạn", not
 * in a countdown. Excluding it is what stops the boundary reload from becoming a
 * loop — the row comes back marked missing, is dropped here, and the countdown
 * moves on to the next genuinely upcoming task.
 *
 * A deadline that has expired locally but is NOT yet marked missing is still
 * returned, deliberately: that gap is exactly what triggers the one refresh that
 * asks the server to re-classify it.
 */
function nextDue(assignments) {
  return assignments
    .filter((a) => !a.submitted_at && a.assignment.due_at && !a.is_missing)
    .map((a) => ({ a, at: new Date(a.assignment.due_at).getTime() }))
    .filter((x) => Number.isFinite(x.at))
    .sort((x, y) => x.at - y.at)[0] || null;
}

function renderCountdown() {
  const next = nextDue((_data && _data.assignments) || []);
  const box = $('mc-due-now');
  if (!next) {
    box.hidden = true;
    if (_tick) { clearInterval(_tick); _tick = null; }
    return;
  }
  box.hidden = false;
  $('mc-due-title').textContent = next.a.assignment.title || 'Bài tập';
  $('mc-due-sub').textContent = taskSub(next.a);
  $('mc-due-start').dataset.item = next.a.item_id;

  const left = next.at - Date.now();
  if (left <= 0) {
    // The deadline passed while this page was open. Re-fetch ONCE so the server
    // re-classifies it as missing; it is then excluded by nextDue() and the
    // countdown moves to the next upcoming task.
    //
    // Two guards, and both are needed. `_reloadingForDeadline` stops a 1-second
    // timer from firing a request per tick while one is in flight.
    // `_deadlineReloaded` remembers WHICH item we already refreshed for: without
    // it, a server that does not mark the row missing (clock skew, a deadline
    // the backend still considers open) would be re-asked every second forever
    // — one request per second per student, which is how the previous fix turned
    // into a worse bug than the one it fixed.
    box.hidden = true;
    const id = next.a.item_id;

    if (_deadlineReloaded.has(id)) {
      // Already refreshed successfully and the server still does not call it
      // missing (clock skew, or a backend that considers it open). Stop — asking
      // again changes nothing and would be one request per second.
      if (_tick) { clearInterval(_tick); _tick = null; }
      return;
    }
    if (_reloadingForDeadline || Date.now() < (_deadlineRetryAfter.get(id) || 0)) {
      return;   // in flight, or backing off — the timer keeps running so we retry
    }

    // Marked as done only AFTER the refresh succeeds. Recording it up front meant
    // a transient network error left the item flagged and the timer cleared, so
    // the page could never obtain the real state again short of a manual reload.
    _reloadingForDeadline = true;
    load()
      .then((ok) => {
        if (ok) _deadlineReloaded.add(id);
        else _deadlineRetryAfter.set(id, Date.now() + DEADLINE_RETRY_MS);
      })
      .finally(() => { _reloadingForDeadline = false; });
    return;
  }

  const el = $('mc-countdown');
  el.textContent = remainingLabel(left);
  // Under an hour is the point at which "còn 40 phút" stops being information
  // and starts being a prompt.
  el.classList.toggle('is-urgent', left < 60 * 60 * 1000);
  $('mc-countdown-label').textContent = dueLabel(next.a.assignment.due_at);
}

function startTicking() {
  if (_tick) clearInterval(_tick);
  _tick = setInterval(renderCountdown, 1000);
}

// ── Starting a task ─────────────────────────────────────────────────────────

/**
 * Every start control for one assignment, both the countdown button and its row
 * in "Cần nộp" — the nearest task is rendered in BOTH places.
 */
function startControlsFor(itemId) {
  return Array.from(document.querySelectorAll(
    `button[data-action="start"][data-item="${CSS.escape(itemId)}"], #mc-due-start`
  )).filter((el) => el.dataset.item === itemId);
}

async function startAssignment(itemId, btn) {
  // Disabling only the clicked control left the other one live: on a slow
  // request a student could click both and start TWO sessions for one intended
  // attempt, burning two of their daily slots. The backend allows repeat
  // sessions per item by design (retries), so this has to be held here.
  if (_startingItem === itemId) return;
  _startingItem = itemId;

  const controls = startControlsFor(itemId);
  const originals = controls.map((el) => el.textContent);
  controls.forEach((el) => { el.disabled = true; el.textContent = 'Đang mở…'; });

  try {
    const r = await api.post('/api/class/assignments/' + encodeURIComponent(itemId) + '/start');
    const p = (r && r.session_params) || {};
    // POST /sessions owns quota, the daily cap and permissions; the class
    // assignment entitles its own mode server-side. Creating the session here
    // rather than in /start keeps all of that in one place.
    const session = await api.post('/sessions', {
      mode: p.mode,
      part: p.part,
      topic: p.topic,
      class_assignment_item_id: p.class_assignment_item_id,
    });
    const sessionId = session && (session.id || session.session_id);
    if (!sessionId) throw new Error('Máy chủ không trả về buổi học hợp lệ.');
    window.location.href = '/pages/practice.html?session_id=' + encodeURIComponent(sessionId);
  } catch (err) {
    window.showToast('Không mở được bài: ' + (err.message || err), 'error', { timeout: 6000 });
    controls.forEach((el, i) => { el.disabled = false; el.textContent = originals[i]; });
    _startingItem = null;
  }
  // On success the page navigates away, so the controls stay disabled on
  // purpose — re-enabling them would invite a second click during the redirect.
}

// ── Load ────────────────────────────────────────────────────────────────────

function render() {
  const d = _data;
  $('mc-loading').hidden = true;

  if (!d.has_class) {
    $('mc-noclass').hidden = false;
    $('mc-content').hidden = true;
    return;
  }
  $('mc-noclass').hidden = true;
  $('mc-content').hidden = false;

  const cls = d.class || {};
  $('mc-class-name').textContent = cls.name || 'Lớp của tôi';
  const course = cls.course;
  $('mc-course').innerHTML = course
    ? `<span class="mc-course-code">${esc(course.code)}</span> ${esc(course.name)}`
    : '';

  // A block that failed to load is named, not silently empty.
  const degraded = d.degraded || [];
  $('mc-degraded').hidden = degraded.length === 0;
  if (degraded.length) {
    const names = { class: 'thông tin lớp', lessons: 'buổi học', assignments: 'bài tập' };
    $('mc-degraded').textContent =
      'Chưa tải được ' + degraded.map((k) => names[k] || k).join(', ')
      + '. Tải lại trang để thử lại.';
  }

  const assignments = d.assignments || [];
  renderStats(d.progress);

  renderGroup('mc-group-missing', 'mc-missing',
    assignments.filter((a) => a.is_missing), { action: true });
  renderGroup('mc-group-todo', 'mc-todo',
    assignments.filter((a) => !a.submitted_at && !a.is_missing), { action: true });
  renderGroup('mc-group-done', 'mc-done',
    assignments.filter((a) => a.submitted_at), { action: false });

  // Only claim "no homework" when the assignments block actually loaded.
  $('mc-group-empty').hidden =
    assignments.length > 0 || degraded.includes('assignments');

  renderLessons(d.lessons || []);
  renderCountdown();
  startTicking();
}

/** True when fresh data arrived; false when the request failed. Callers use the
 *  result to decide whether a deadline refresh actually happened. */
async function load() {
  try {
    _data = await api.get('/api/class/me');
  } catch (err) {
    $('mc-loading').hidden = true;
    $('mc-content').hidden = true;
    $('mc-noclass').hidden = true;
    window.showToast('Không tải được lớp của bạn: ' + (err.message || err),
      'error', { persist: true });
    return false;
  }
  render();
  return true;
}

function main() {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action="start"], #mc-due-start');
    if (btn && btn.dataset.item) startAssignment(btn.dataset.item, btn);
  });
  // Stop the timer when the tab is hidden; resume (and re-sync) on return, so a
  // page left open overnight does not show yesterday's countdown.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (_tick) { clearInterval(_tick); _tick = null; }
    } else if (_data && _data.has_class) {
      load();
    }
  });
  load();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}
