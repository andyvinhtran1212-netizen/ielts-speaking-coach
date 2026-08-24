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
  // Bài theo buổi chấm bằng PHẦN TRĂM của cổng thuộc bài — "Band 85.0" là một
  // con số không tồn tại trên thang IELTS. Kèm trạng thái đạt khi đã chốt.
  const isCourse = row.assignment && row.assignment.skill === 'course';
  const band = row.score == null ? ''
    : isCourse
      ? ` · <span class="mc-band">${esc(Math.round(Number(row.score)))}%${row.passed_at ? ' · đã đạt' : ''}</span>`
      : ` · <span class="mc-band">Band ${esc(row.score)}</span>`;
  return (row.is_late ? `Nộp trễ lúc ${esc(when)}` : `Đã nộp lúc ${esc(when)}`) + band;
}

const SKILL_LABEL = { speaking: 'Speaking', writing: 'Writing',
                     reading: 'Reading', listening: 'Listening',
                     course: 'Bài tập theo buổi' };

function taskSub(a) {
  const cfg = a.assignment.content_config || {};
  if (a.assignment.skill === 'speaking') {
    return [cfg.topic, cfg.part ? `Part ${cfg.part}` : ''].filter(Boolean).join(' · ');
  }
  if (a.assignment.skill === 'course') {
    // "Buổi 3" là thứ học viên nhận ra ngay; tên bộ đề đứng sau nó.
    return [cfg.lesson_no ? `Buổi ${cfg.lesson_no}` : '', cfg.test_title]
      .filter(Boolean).join(' · ');
  }
  // For a test the paper's own title is the useful line, not the topic field.
  return [SKILL_LABEL[a.assignment.skill] || a.assignment.skill,
          cfg.test_title].filter(Boolean).join(' · ');
}

// ── Rendering ───────────────────────────────────────────────────────────────

/**
 * Xong phần trắc nghiệm nhưng CHƯA nộp tự luận.
 *
 * `passed_at` do cổng thuộc-bài ghi khi em ấy qua phần trắc nghiệm; `submitted_at`
 * nay CHỈ được ghi khi nộp phần tự luận (bộ đề nào có phần ấy). Hai cờ lệch nhau
 * đúng bằng khoảng "còn mười câu chưa động tới".
 *
 * Không nói ra thì bài nằm im ở "Cần nộp" y như một bài chưa mở — mà em ấy đã
 * làm chín chặng rồi, và chỉ còn một bước.
 */
const awaitingWriting = (a) => a.assignment.skill === 'course'
  // Máy chủ nói bộ đề này CÓ phần tự luận hay không — không suy từ hai cờ kia.
  // Một lượt ghi sổ hỏng (best-effort) ở bộ đề KHÔNG có tự luận cũng cho ra
  // đúng hình dạng `passed_at && !submitted_at`, và học viên đọc thành "còn
  // phần tự luận" cho một phần không tồn tại (codex cục bộ 06/08).
  && !!a.writing_expected
  && !!a.passed_at && !a.submitted_at;

function itemRow(a, { action }) {
  const sub = taskSub(a);
  const isPartial = awaitingWriting(a);
  const state = a.submitted_at ? 'done' : a.is_missing ? 'missing' : 'todo';
  const stateLabel = a.submitted_at ? (a.is_late ? 'Đã nộp trễ' : 'Đã nộp')
    : a.is_missing ? 'Đã quá hạn'
      : isPartial ? 'Còn phần tự luận' : 'Cần hoàn thành';
  // `typeof` keeps the small extracted unit-test harness honest while the real
  // page still consumes the shared map declared above.
  const kindLabel = (typeof SKILL_LABEL !== 'undefined' && SKILL_LABEL[a.assignment.skill])
    || a.assignment.skill || 'Bài tập';
  const meta = a.submitted_at
    ? submittedLabel(a)
    : isPartial
      ? `<span class="mc-partial">Chưa hoàn tất — còn phần tự luận</span>`
        + ` · ${esc(dueLabel(a.assignment.due_at))}${a.is_missing ? ' · quá hạn' : ''}`
      : `${esc(dueLabel(a.assignment.due_at))}${a.is_missing ? ' · quá hạn' : ''}`;
  // Quá hạn thì KHÔNG có nút. Hạn nộp nay là tuyệt đối — bấm vào chỉ để nhận
  // 409 sau một vòng gọi mạng, và một nút chỉ-để-thất-bại tệ hơn không có nút:
  // học viên bấm mấy lần rồi tưởng lỗi ở máy mình.
  //
  // Bài vẫn CÒN trên danh sách, ghi là quá hạn — biến mất sẽ đọc ra thành "em
  // chưa từng có bài đó" thay vì "em đã bỏ lỡ".
  //
  // NHƯNG "không nhận bài nữa" khác "không được xem lại bài mình đã làm". Bài
  // Speaking đã nộp (hoặc đã quá hạn mà có bài) mở lại được để đọc nhận xét
  // từng câu — lệnh /start trả về chính phiên cũ, và phiếu tự khoá ở chế độ
  // chỉ-đọc. Nhãn nói đúng việc nút làm, không hứa "làm bài".
  const canReviewCourse = a.assignment.skill === 'course' && a.submitted_at;
  const canReviewSpeaking = a.assignment.skill === 'speaking'
    && (a.submitted_at || (a.is_missing && a.state !== 'assigned'));
  const canReview = canReviewCourse || canReviewSpeaking;
  const btn = canReview
    ? `<button class="av-button av-button-secondary" data-action="start" data-item="${esc(a.item_id)}">${canReviewCourse ? 'Xem kết quả' : 'Xem lại bài'}</button>`
    : (action && !a.is_missing)
      ? `<button class="av-button av-button-primary" data-action="start" data-item="${esc(a.item_id)}">${isPartial ? 'Tiếp tục bài' : 'Làm bài'}</button>`
      : '';
  const closedNextStep = a.is_missing && !canReview
    ? '<p class="mc-item-next-step">Hạn nộp đã đóng. Liên hệ giảng viên nếu bạn cần được mở lại bài.</p>'
    : '';
  return `<article class="mc-item${a.is_missing ? ' is-missing' : ''}">
    <div class="mc-item-main">
      <div class="mc-item-meta">
        <span class="mc-item-kind">${esc(kindLabel)}</span>
        <span class="mc-item-state" data-state="${state}">${esc(stateLabel)}</span>
      </div>
      <p class="mc-item-title">${esc(a.assignment.title)}</p>
      ${sub ? `<p class="mc-item-sub">${esc(sub)}</p>` : ''}
      <p class="mc-item-sub${a.is_missing ? ' is-alarm' : ''}">${meta}</p>
      ${a.assignment.instructions ? `<p class="mc-item-sub">${esc(a.assignment.instructions)}</p>` : ''}
      ${closedNextStep}
    </div>
    ${btn}
  </article>`;
}

function renderGroup(groupId, listId, rows, opts) {
  $(groupId).hidden = rows.length === 0;
  if (rows.length) $(listId).innerHTML = rows.map((a) => itemRow(a, opts)).join('');
}

/**
 * NHỊP LỚP — 14 ngày gần nhất, mỗi ngày một ô.
 *
 * Dựng từ chính danh sách bài tập đã có trên trang; không gọi thêm gì. Ngày là
 * NGÀY VIỆT NAM của hạn nộp: hạn 19:00 giờ VN là 12:00Z, nhưng một bài hạn
 * 06:00 sáng là 23:00Z HÔM TRƯỚC — lấy ngày UTC thì cả dải lệch một ô.
 */
const RHYTHM_DAYS = 14;
const RHYTHM_MARK = { done: '✓', late: '◐', missing: '✕', none: '' };

/** Date → 'YYYY-MM-DD' theo giờ Việt Nam. */
function vnDay(d) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(d);
  } catch (e) { return d.toISOString().slice(0, 10); }
}

/** Trạng thái một ngày, gộp nhiều bài trong ngày — ĐÃ LÀM thắng CHƯA LÀM. */
export function rhythmDays(assignments, now = new Date()) {
  const RANK = { done: 0, late: 1, missing: 2 };
  const by = {};
  (assignments || []).forEach((a) => {
    const raw = a.assignment && a.assignment.due_at;
    if (!raw) return;
    const due = new Date(raw);
    if (Number.isNaN(due.getTime())) return;
    const day = vnDay(due);
    let st;
    if (a.submitted_at) st = a.is_late ? 'late' : 'done';
    else if (due < now) st = 'missing';
    else return;                    // chưa tới hạn — chưa phải là bỏ bài
    if (!by[day] || RANK[st] < RANK[by[day]]) by[day] = st;
  });

  const today = vnDay(now);
  const out = [];
  for (let i = RHYTHM_DAYS - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000);
    const day = vnDay(d);
    out.push({ day, state: by[day] || 'none', today: day === today });
  }
  return out;
}

function renderRhythm(assignments) {
  const box = $('mc-rhythm');
  if (!box) return;
  const days = rhythmDays(assignments || []);
  const active = days.filter((d) => d.state !== 'none').length;
  // Chưa có ngày nào có bài thì ẩn hẳn: một dải 14 ô trống đọc như "em bỏ 14
  // ngày", mà sự thật là lớp chưa giao bài nào.
  if (!active) { box.hidden = true; return; }
  box.hidden = false;

  $('mc-rhythm-row').innerHTML = days.map((d) => {
    const label = d.state === 'none' ? 'không có bài'
      : d.state === 'done' ? 'đã nộp'
      : d.state === 'late' ? 'nộp trễ' : 'chưa nộp';
    return `<i data-s="${esc(d.state)}"${d.today ? ' data-today' : ''}`
      + ` title="${esc(d.day)} — ${label}">${RHYTHM_MARK[d.state]}</i>`;
  }).join('');

  const kept = days.filter((d) => d.state === 'done' || d.state === 'late').length;
  const miss = days.filter((d) => d.state === 'missing').length;
  $('mc-rhythm-note').textContent = miss
    ? `${kept}/${active} buổi đã nộp · ${miss} buổi bỏ lỡ`
    : `${kept}/${active} buổi đã nộp — đang đều`;
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

    // Reading/Listening open their existing test pages: those pages own the
    // attempt lifecycle, and the hand-in is picked up afterwards from the
    // attempt row. Nothing is created here.
    if (r && r.open_url) {
      window.location.href = r.open_url;
      return;
    }

    // Bài tập theo buổi: mở thẳng bằng id bank. Không có phiên nào phải dựng
    // trước — chính bài giao vừa được xác nhận ở lệnh /start là thứ cho phép
    // trang kia đọc được bank ấy.
    if (r && r.bank_id) {
      window.location.href = '/course-exercises?bank=' + encodeURIComponent(r.bank_id)
        + (r.review_only === true
          ? '&view=writing&class_item=' + encodeURIComponent(r.item_id) : '');
      return;
    }

    // A completed Speaking artifact belongs on the canonical result page. It
    // is no longer a live player dependency, even if its historical renderer
    // affinity was Legacy.
    if (r && r.result_session_id) {
      window.location.href = '/result?id=' + encodeURIComponent(r.result_session_id);
      return;
    }

    // Bài Speaking ĐÃ CÓ phiên: mở lại CHÍNH nó, không dựng phiên mới. Dựng
    // mới nghĩa là bài em ấy vừa nói nằm lại phiên cũ và màn hình mở ra trắng
    // trơn — đúng lỗi "làm rồi mà refresh là mất". Phiên cũ cũng là đường xem
    // lại nhận xét sau khi đã nộp hoặc đã hết hạn.
    if (r && r.session_id) {
      window.location.href = '/pages/practice.html?session_id='
        + encodeURIComponent(r.session_id);
      return;
    }

    const p = (r && r.session_params) || {};
    // Speaking: POST /sessions owns quota, the daily cap and permissions; the
    // class assignment entitles its own mode server-side. Creating the session
    // here rather than in /start keeps all of that in one place.
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
  //
  // Two different problems, two different sentences. A block that did not load
  // shows nothing and reloading is the fix. `homework_stale` is the opposite:
  // the list IS here and looks complete, but a hand-in of ANY skill may not be
  // folded in yet — so a task the student has already done can still be
  // sitting under "Cần nộp", and telling them to reload would send them to
  // retake work they finished.
  const degraded = d.degraded || [];
  const names = { class: 'thông tin lớp', lessons: 'buổi học', assignments: 'bài tập' };
  const stale = degraded.includes('homework_stale');
  const unread = degraded.filter((k) => k !== 'homework_stale');
  const notes = [];
  if (unread.length) {
    notes.push('Chưa tải được ' + unread.map((k) => names[k] || k).join(', ')
      + '. Tải lại trang để thử lại.');
  }
  if (stale) {
    // Không nêu tên kỹ năng: cờ này bật cho mọi đường vá sổ, nên nhắc riêng
    // hai kỹ năng sẽ khiến em ấy yên tâm về đúng những kỹ năng đang cũ.
    notes.push('Bài bạn vừa nộp có thể chưa hiện ở đây. '
      + 'Nếu đã làm xong, không cần làm lại.');
  }
  $('mc-degraded').hidden = notes.length === 0;
  if (notes.length) $('mc-degraded').textContent = notes.join(' ');

  const assignments = d.assignments || [];
  renderStats(d.progress);
  renderRhythm(assignments);

  renderGroup('mc-group-missing', 'mc-missing',
    assignments.filter((a) => a.is_missing), { action: true });   // itemRow tự bỏ nút
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
    const nextData = await api.get('/api/class/me');
    // The page contract is an object with an explicit boolean. A transient
    // gateway/null body must use the existing visible load-error state instead
    // of escaping the try block as `Cannot read ... has_class` from render().
    if (!nextData || typeof nextData !== 'object'
        || typeof nextData.has_class !== 'boolean') {
      throw new Error('Máy chủ trả về dữ liệu lớp không hợp lệ.');
    }
    _data = nextData;
    render();
  } catch (err) {
    $('mc-loading').hidden = true;
    $('mc-content').hidden = true;
    $('mc-noclass').hidden = true;
    window.showToast('Không tải được lớp của bạn: ' + (err.message || err),
      'error', { persist: true });
    return false;
  }
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
