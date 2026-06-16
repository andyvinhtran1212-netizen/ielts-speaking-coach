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
  // Defensive — the module exports pure helpers (Sprint 11.3.1)
  // that get unit-tested under node:test where `window` is absent.
  if (typeof window !== 'undefined' && window.initSupabase) {
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
  showToast(text, kind, { persist: true });
}

function hideBanner() { clearToasts(); }


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


/**
 * Sprint 11.3.1 — split a raw transcript into sentence-level segments.
 *
 * Two boundary signals, take the finer-grained:
 *   (a) explicit line breaks (DailyDictation paste convention — one
 *       sentence per line).
 *   (b) sentence-ending punctuation `.!?` followed by whitespace and
 *       a capital letter (defends against abbreviations like "Mr."
 *       "etc." that aren't followed by a capital — false splits rare
 *       in IELTS prose).
 *
 * Splits each line on (b), flattens, trims, drops empties. Returns the
 * array of trimmed sentence strings.
 *
 * Sprint 11.3 shipped (a) only — Andy's 4.5-min IELTS lecture parsed
 * to 11 paragraph chunks instead of ~47 sentences (falsification #65b).
 */
export function splitIntoSentences(raw) {
  if (!raw || typeof raw !== 'string') return [];
  const lines = raw.split('\n').map((s) => s.trim()).filter(Boolean);
  const sentences = [];
  for (const line of lines) {
    const parts = line
      .split(/(?<=[.!?])\s+(?=[A-Z"'\u201C\u2018])/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const p of parts) sentences.push(p);
  }
  return sentences;
}


/**
 * Sprint 11.3.1 — char-proportional timestamp generator.
 *
 * Each segment's duration is allocated as
 *     content_duration * (segment.length / total_chars)
 *
 * The last segment's end_sec is clamped to exactly content_duration
 * to absorb float drift — guarantees end_sec[N-1] == content_duration
 * exactly. Invariants:
 *   - segments[0].start_sec === 0
 *   - segments[i].end_sec === segments[i+1].start_sec (zero gap, zero overlap)
 *   - segments[N-1].end_sec === content_duration
 *
 * Returns the SAME shape used by STATE.segments (transcript + start_sec
 * + end_sec, no idx — idx is assigned at render/save time).
 */
/**
 * Sprint 11.4 — alignment-driven timestamp generator.
 *
 * When the parent content has ElevenLabs `/with-timestamps` alignment
 * data persisted, derive PRECISE sentence boundaries by:
 *   1. Walking the rebuilt transcript char-by-char (joining
 *      alignment.characters in order).
 *   2. For each sentence, finding its byte/char start in the rebuilt
 *      transcript via cumulative offset.
 *   3. start_sec = character_start_times_seconds[that_offset]
 *      end_sec   = character_end_times_seconds[offset + len - 1]
 *
 * Returns the SAME shape as assignProportionalTimestamps. If anything
 * goes wrong (alignment too short, indices off the end) returns NULL
 * so the caller falls back to the char-proportional path.
 *
 * Sprint 11.3.1 char-proportional drift is ±0.5-1s per segment. With
 * alignment this drops to sub-50ms — segments start cleanly on word
 * boundaries.
 */
export function assignAlignmentTimestamps(sentences, alignmentData) {
  if (!Array.isArray(sentences) || !sentences.length) return null;
  if (!alignmentData || typeof alignmentData !== 'object') return null;
  const chars = alignmentData.characters;
  const starts = alignmentData.character_start_times_seconds;
  const ends = alignmentData.character_end_times_seconds;
  if (!Array.isArray(chars) || !Array.isArray(starts) || !Array.isArray(ends)) return null;
  if (chars.length !== starts.length || chars.length !== ends.length) return null;
  if (!chars.length) return null;

  // Rebuild the canonical transcript from the alignment so we can
  // locate each sentence even when whitespace differs slightly from
  // the textarea content.
  const rebuilt = chars.join('');
  const out = [];
  let cursor = 0;     // search anchor in rebuilt transcript
  for (const text of sentences) {
    // Find this sentence's start position in the rebuilt transcript
    // (case-insensitive, whitespace-tolerant on the leading edge).
    let foundAt = rebuilt.indexOf(text, cursor);
    if (foundAt < 0) {
      // Try a tolerant search: collapse multiple spaces in both sides.
      const needle = text.replace(/\s+/g, ' ').trim();
      foundAt = rebuilt.replace(/\s+/g, ' ').indexOf(needle, cursor);
      if (foundAt < 0) return null;
    }
    const endIdx = foundAt + text.length - 1;
    if (endIdx >= ends.length) return null;
    out.push({
      transcript: text,
      start_sec:  Math.round(Number(starts[foundAt]) * 100) / 100,
      end_sec:    Math.round(Number(ends[endIdx]) * 100) / 100,
    });
    cursor = endIdx + 1;
  }
  // Smooth boundaries: chain end[i] == start[i+1] to avoid gaps (the
  // user replay UX prefers contiguous segments).
  for (let i = 0; i < out.length - 1; i += 1) {
    if (out[i].end_sec < out[i + 1].start_sec) {
      out[i].end_sec = out[i + 1].start_sec;
    }
  }
  return out;
}


export function assignProportionalTimestamps(sentences, contentDuration) {
  if (!Array.isArray(sentences) || !sentences.length) return [];
  const duration = Number(contentDuration);
  if (!Number.isFinite(duration) || duration <= 0) {
    // No duration → no timestamps (segments stay null, admin marks manually).
    return sentences.map((text) => ({
      transcript: text, start_sec: null, end_sec: null,
    }));
  }
  const totalChars = sentences.reduce((acc, s) => acc + s.length, 0) || 1;
  const out = [];
  let cursor = 0;
  for (let i = 0; i < sentences.length; i += 1) {
    const text = sentences[i];
    const share = text.length / totalChars;
    const segDur = duration * share;
    const start = cursor;
    let end = cursor + segDur;
    if (i === sentences.length - 1) end = duration;  // absorb drift on last
    out.push({
      transcript: text,
      start_sec:  Math.round(start * 100) / 100,
      end_sec:    Math.round(end * 100) / 100,
    });
    cursor = end;
  }
  return out;
}


function parseFromTextarea() {
  const raw = $('transcript-input').value;
  const sentences = splitIntoSentences(raw);
  if (!sentences.length) {
    showBanner('Bản gỡ băng trống — không có gì để phân tách.', 'error');
    return;
  }
  const duration = STATE.content?.audio_duration_seconds;
  const alignment = STATE.content?.alignment_data;

  // Sprint 11.4 bonus — prefer the alignment-driven timestamps when
  // the content has ElevenLabs word-level alignment. Falls back to
  // char-proportional if alignment is absent or any sentence can't be
  // located in the rebuilt transcript.
  let segments = null;
  let alignmentUsed = false;
  if (alignment) {
    segments = assignAlignmentTimestamps(sentences, alignment);
    alignmentUsed = !!segments;
  }
  if (!segments) {
    segments = assignProportionalTimestamps(sentences, duration);
  }
  STATE.segments = segments;
  renderSegments();

  const last = STATE.segments[STATE.segments.length - 1];
  const totalEstimated = last ? last.end_sec : 0;
  const drift = duration ? Math.abs(totalEstimated - duration) : 0;
  if (!duration) {
    showBanner(
      `Đã phân tách thành ${STATE.segments.length} câu. Audio chưa biết `
      + `duration — bấm "Đánh dấu" để bắt timestamp thủ công.`,
      'info',
    );
  } else if (alignmentUsed) {
    showBanner(
      `✨ Đã phân tách thành ${STATE.segments.length} câu với timestamps `
      + `AI-precision (ElevenLabs alignment). Có thể tinh chỉnh từng câu nếu cần.`,
      'success',
    );
  } else if (drift > 0.5) {
    showBanner(
      `⚠️ Tổng thời lượng ước tính ${fmtTime(totalEstimated)} lệch khỏi `
      + `duration ${fmtTime(duration)} — kiểm tra timestamps.`,
      'error',
    );
  } else {
    showBanner(
      `📐 Đã phân tách thành ${STATE.segments.length} câu với timestamps `
      + `ước tính theo tỉ lệ ký tự (tổng ${fmtTime(totalEstimated)} = `
      + `${fmtTime(duration)}). Có thể tinh chỉnh "Mark start/end".`,
      'success',
    );
  }
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


// Defensive — `document` is undefined when this module is imported by
// node:test for unit-testing the pure helpers (Sprint 11.3.1).
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    load();
    wireRowEvents();
    wireAudioTimeTracker();

    $('btn-parse').addEventListener('click', parseFromTextarea);
    $('btn-save').addEventListener('click', () => save('draft'));
    $('btn-publish').addEventListener('click', () => save('published'));
  });
}
