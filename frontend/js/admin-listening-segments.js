/**
 * frontend/js/admin-listening-segments.js — Sprint 11.3 (DEBT-LISTENING-
 * MODULE 3/5).
 *
 * Admin segment-authoring page. Workflow:
 *   1. URL: ?content_id=<UUID>
 *   2. Page fetches GET /admin/listening/content/{id} (admin endpoint
 *      bypasses status='published' filter so drafts are previewable).
 *   3. Textarea pre-filled with content.transcript. Admin edits to
 *      one segment per line.
 *   4. "Phân tách" splits textarea on newlines + creates N segment rows
 *      with empty timestamps. Existing segments are preserved on re-edit
 *      via GET /admin/listening/exercises?content_id=...&exercise_type=dictation.
 *   5. For each segment: "Đánh dấu" start/end captures audio.currentTime
 *      OR admin types mm:ss.s manually.
 *   6. Save → POST /admin/listening/exercises with {content_id, segments}.
 *
 * Inline validation only — server is the source of truth (router-side
 * _validate_dictation_segments). Client surface highlights bad rows
 * but the canonical 422 message comes back from POST.
 */

const SUPABASE_URL = 'https://nqhrtqspznepmveyurzm.supabase.co';
const SUPABASE_ANON = 'sb_publishable_a_vDrA0c3mT-QlASPW7yhw_YZnUsfT4';

(function bootstrapSupabase() {
  if (window.initSupabase) {
    try { window.initSupabase(SUPABASE_URL, SUPABASE_ANON); } catch { /* swallow */ }
  }
})();

const $ = (id) => document.getElementById(id);

const STATE = {
  contentId:   null,
  content:     null,
  exerciseId:  null,
  segments:    [],   // [{transcript, start_sec, end_sec}]
};


// ── mm:ss.s formatting + parsing ─────────────────────────────────────


function fmtTime(sec) {
  if (sec == null || !Number.isFinite(sec)) return '';
  const s = Math.max(0, Number(sec));
  const m = Math.floor(s / 60);
  const remain = s - m * 60;
  return `${m}:${remain.toFixed(1).padStart(4, '0')}`;
}

/**
 * Parse "mm:ss.s" or "ss.s" or "ss" → seconds float. Returns null on
 * unparseable input.
 */
function parseTime(str) {
  if (str == null) return null;
  const trimmed = String(str).trim();
  if (!trimmed) return null;
  const colonParts = trimmed.split(':');
  let sec;
  if (colonParts.length === 1) {
    sec = Number(colonParts[0]);
  } else if (colonParts.length === 2) {
    const m = Number(colonParts[0]);
    const s = Number(colonParts[1]);
    if (!Number.isFinite(m) || !Number.isFinite(s)) return null;
    sec = m * 60 + s;
  } else {
    return null;
  }
  if (!Number.isFinite(sec) || sec < 0) return null;
  return sec;
}


// ── Banner ───────────────────────────────────────────────────────────


function showBanner(text, kind = 'info') {
  const b = $('status-banner');
  b.textContent = text;
  b.classList.remove('is-info', 'is-success', 'is-error');
  b.classList.add(`is-${kind}`);
  b.hidden = false;
}

function hideBanner() { $('status-banner').hidden = true; }


// ── Initial load ─────────────────────────────────────────────────────


function getContentIdFromUrl() {
  const sp = new URLSearchParams(window.location.search);
  return (sp.get('content_id') || '').trim() || null;
}


async function load() {
  const contentId = getContentIdFromUrl();
  if (!contentId) {
    showBanner('Thiếu ?content_id trong URL.', 'error');
    return;
  }
  STATE.contentId = contentId;

  try {
    const content = await window.api.get(`/admin/listening/content/${contentId}`);
    STATE.content = content;
    $('content-info').innerHTML =
      `<strong>${escapeHtml(content.title || 'Bài nghe')}</strong>`
      + `<br><span style="color: var(--av-text-muted); font-size: var(--av-fs-xs);">`
      + `Duration: ${content.audio_duration_seconds}s · `
      + `Status: ${content.status} · `
      + `ID: ${escapeHtml(content.id)}</span>`;

    const player = $('player');
    if (content.audio_signed_url) {
      player.setAttribute('src', content.audio_signed_url);
      player.setAttribute(
        'refetch-url', `/admin/listening/content/${contentId}`,
      );
    }

    // Pre-fill textarea from the content transcript (admin can edit).
    $('transcript-input').value = content.transcript || '';

    // Load any existing dictation exercise.
    const exRes = await window.api.get(
      `/admin/listening/exercises?content_id=${encodeURIComponent(contentId)}&exercise_type=dictation`,
    );
    const ex = (exRes && exRes.exercises || [])[0];
    if (ex) {
      STATE.exerciseId = ex.id;
      STATE.segments = (ex.segments || []).slice().sort((a, b) => (a.idx || 0) - (b.idx || 0))
        .map((s) => ({
          transcript: s.transcript || '',
          start_sec:  Number(s.start_sec) || 0,
          end_sec:    Number(s.end_sec) || 0,
        }));
      renderSegments();
      showBanner(
        `Đang chỉnh sửa exercise ${ex.id} (${STATE.segments.length} câu, status=${ex.status}).`,
        'info',
      );
    } else {
      showBanner('Chưa có exercise — bấm "Phân tách" để bắt đầu.', 'info');
    }
  } catch (e) {
    showBanner(`Tải bài thất bại: ${e.message || e}`, 'error');
  }
}


// ── Parse + render segments ──────────────────────────────────────────


function parseFromTextarea() {
  const lines = $('transcript-input').value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!lines.length) {
    showBanner('Bản gỡ băng trống — không có gì để phân tách.', 'error');
    return;
  }
  // Preserve existing timestamps where line count + position match.
  const oldSegments = STATE.segments.slice();
  STATE.segments = lines.map((text, i) => ({
    transcript: text,
    start_sec:  oldSegments[i]?.start_sec ?? null,
    end_sec:    oldSegments[i]?.end_sec ?? null,
  }));
  renderSegments();
  showBanner(
    `Đã phân tách thành ${STATE.segments.length} câu. Bấm "Đánh dấu" để bắt timestamp.`,
    'info',
  );
}


function renderSegments() {
  const list = $('segments-list');
  list.innerHTML = '';
  STATE.segments.forEach((seg, i) => {
    const li = document.createElement('li');
    li.dataset.idx = String(i);
    li.innerHTML = `
      <span class="seg-idx">#${i + 1}</span>
      <div class="seg-grid">
        <input class="seg-transcript-input" data-field="transcript"
               value="${escapeAttr(seg.transcript)}" />
        <input class="seg-time-input" data-field="start"
               placeholder="0:00.0"
               value="${escapeAttr(seg.start_sec != null ? fmtTime(seg.start_sec) : '')}" />
        <input class="seg-time-input" data-field="end"
               placeholder="0:00.0"
               value="${escapeAttr(seg.end_sec != null ? fmtTime(seg.end_sec) : '')}" />
      </div>
      <div class="seg-row-actions">
        <button class="btn-ghost" type="button" data-action="mark-start">↳ Start</button>
        <button class="btn-ghost" type="button" data-action="mark-end">↲ End</button>
        <button class="btn-danger" type="button" data-action="delete">Xóa</button>
      </div>
    `;
    list.appendChild(li);
  });
  highlightInvalid();
}


function highlightInvalid() {
  const lis = $('segments-list').querySelectorAll('li');
  lis.forEach((li, i) => {
    const seg = STATE.segments[i];
    if (!seg) return;
    const bad =
      !seg.transcript.trim()
      || seg.start_sec == null
      || seg.end_sec == null
      || seg.end_sec <= seg.start_sec;
    li.classList.toggle('has-error', bad);
  });
}


// ── Row event delegation ─────────────────────────────────────────────


function wireRowEvents() {
  $('segments-list').addEventListener('input', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    const idx = Number(li.dataset.idx);
    const field = e.target.dataset.field;
    if (!STATE.segments[idx]) return;
    if (field === 'transcript') {
      STATE.segments[idx].transcript = e.target.value;
    } else if (field === 'start') {
      STATE.segments[idx].start_sec = parseTime(e.target.value);
    } else if (field === 'end') {
      STATE.segments[idx].end_sec = parseTime(e.target.value);
    }
    highlightInvalid();
  });

  $('segments-list').addEventListener('click', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    const idx = Number(li.dataset.idx);
    const action = e.target.dataset.action;
    if (!action) return;
    const seg = STATE.segments[idx];
    if (!seg) return;

    if (action === 'mark-start' || action === 'mark-end') {
      const player = $('player');
      // Use the player's internal audio currentTime via the public DOM
      // — but the audio element is in shadow DOM. Workaround: dispatch
      // a probe via the existing pause()/play() public API isn't quite
      // right. Simpler: read window.audioCurrentTime if exposed, else
      // fall back to a manual entry prompt. For Sprint 11.3 we listen
      // to av-audio-pause + cache currentTime via the timeupdate
      // bubble. See wireAudioTimeTracker below.
      const t = STATE._lastAudioTime;
      if (!Number.isFinite(t)) {
        showBanner('Hãy phát audio trước khi đánh dấu.', 'error');
        return;
      }
      if (action === 'mark-start') seg.start_sec = round1(t);
      else seg.end_sec = round1(t);
      renderSegments();
    } else if (action === 'delete') {
      STATE.segments.splice(idx, 1);
      renderSegments();
    }
  });
}


function round1(n) { return Math.round(n * 10) / 10; }


/**
 * The audio player keeps its <audio> in shadow DOM, but `timeupdate`
 * events bubble out as `av-audio-play` (just play) — we don't get
 * timeupdate directly. Workaround: listen to play events + poll
 * currentTime through the shadow-piercing method that the component
 * doesn't yet expose. For now: snapshot currentTime via a setInterval
 * poll while the player has played at least once.
 *
 * Sprint 11.4 idea: expose `getCurrentTime()` as a public method on
 * the audio-player component to drop the polling.
 */
function wireAudioTimeTracker() {
  const player = $('player');
  let pollHandle = null;

  function startPoll() {
    if (pollHandle) return;
    pollHandle = setInterval(() => {
      // Best-effort shadow probe — the component exposes a method-free
      // surface, so we peek at its internal _audio element if present.
      const internal = player._audio;
      if (internal && Number.isFinite(internal.currentTime)) {
        STATE._lastAudioTime = internal.currentTime;
      }
    }, 200);
  }
  function stopPoll() {
    if (pollHandle) { clearInterval(pollHandle); pollHandle = null; }
  }

  player.addEventListener('av-audio-play',  startPoll);
  player.addEventListener('av-audio-pause', () => {
    // Snapshot once on pause so the timestamp is exact when admin
    // pauses at the cut point.
    const internal = player._audio;
    if (internal && Number.isFinite(internal.currentTime)) {
      STATE._lastAudioTime = internal.currentTime;
    }
  });
  player.addEventListener('av-audio-ended', stopPoll);
}


// ── Save ─────────────────────────────────────────────────────────────


function buildSavePayload(status) {
  // Server validates strictly; client just produces the shape.
  const segments = STATE.segments.map((seg, i) => ({
    idx:        i,
    start_sec:  Number(seg.start_sec) || 0,
    end_sec:    Number(seg.end_sec) || 0,
    transcript: (seg.transcript || '').trim(),
  }));
  return {
    content_id:    STATE.contentId,
    exercise_type: 'dictation',
    segments,
    status,
  };
}


async function save(status) {
  if (!STATE.segments.length) {
    showBanner('Chưa có câu nào — bấm "Phân tách" trước.', 'error');
    return;
  }
  $('btn-save').disabled = true;
  $('btn-publish').disabled = true;
  try {
    const out = await window.api.post(
      '/admin/listening/exercises',
      buildSavePayload(status),
    );
    STATE.exerciseId = out.exercise_id;
    showBanner(
      `Đã ${out.created ? 'tạo' : 'cập nhật'} exercise (${out.exercise_id}, status=${status}).`,
      'success',
    );
  } catch (e) {
    showBanner(`Lưu thất bại: ${e.message || e}`, 'error');
  } finally {
    $('btn-save').disabled = false;
    $('btn-publish').disabled = false;
  }
}


// ── escapeHtml + escapeAttr ──────────────────────────────────────────


function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function escapeAttr(s) { return escapeHtml(s); }


// ── Wire ─────────────────────────────────────────────────────────────


document.addEventListener('DOMContentLoaded', () => {
  load();
  wireRowEvents();
  wireAudioTimeTracker();

  $('btn-parse').addEventListener('click', parseFromTextarea);
  $('btn-save').addEventListener('click', () => save('draft'));
  $('btn-publish').addEventListener('click', () => save('published'));
});
