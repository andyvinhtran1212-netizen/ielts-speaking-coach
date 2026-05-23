/**
 * frontend/js/cue-card-detector.js — Sprint 14.4
 *
 * Detect whether a custom-question paste is an IELTS Part 2 cue card.
 *
 * Heuristic (Andy lock L2 — ALL three signals required):
 *   1. First non-empty line starts with "Describe …" / "Talk about …"
 *      / "Tell me about …".
 *   2. Body contains "You should say" / "You should mention" / "You
 *      should include" / "You should describe" (any case).
 *   3. ≥ 2 bullet lines (`-`, `•`, `*`, or numbered `1.`).
 *
 * The cue card flow takes the WHOLE paste as one Part 2 monologue
 * prompt and persists the extracted bullets to `questions.cue_card_bullets`
 * (jsonb), which the existing practice.js Part 2 state machine already
 * consumes. The pre-Sprint-14.4 parser naive-split the paste into N
 * separate questions — confusing the user and breaking the Cambridge
 * exam format.
 *
 * L3 — when the heuristic is uncertain we fall back to single questions
 *       (the safer default: more questions is recoverable; one wrong
 *       cue-card lock-in is not).
 *
 * L7 — output shape for cue card:
 *        { type: "cue_card", prompt, topic, bullets }
 *      Single questions keep the legacy string list for backward compat
 *      (L8) — the backend's `_CustomQBody` accepts both.
 *
 * Pure functions, no DOM access, no module system magic — the file
 * loads as a plain <script> in speaking.html and exposes a single
 * window.CueCardDetector namespace + a node:test-friendly export hook.
 */

(function () {
  'use strict';

  // Heuristic signal 1 — opening keyword. Cambridge cue cards from the
  // 2020-2024 corpus all use one of these openings (audited Sprint 14.4
  // pre-flight against the 12-card sample embedded in
  // tests/cue-card-detector.test.mjs).
  var OPENING_RE = /^\s*(describe|talk about|tell me about)\b/i;

  // Signal 2 — "you should say" phrasing. Includes the common variants
  // observed in IELTS materials.
  var YOU_SHOULD_RE = /you\s+should\s+(say|mention|include|describe)\b/i;

  // Signal 3 — bullet-line markers. Matches `-`, `•`, `*`, or
  // numbered list items (`1.`, `2)` etc.). Anchored to start-of-line
  // after trim so prose containing dashes mid-sentence doesn't count.
  var BULLET_RE = /^([-•*]|\d+[.)])\s+/;

  /**
   * Detect whether `text` is an IELTS Part 2 cue card.
   *
   * @param {string} text — raw textarea contents
   * @returns {{isCueCard: boolean, topic: string|null, bullets: string[]|null}}
   */
  function detectCueCard(text) {
    if (text == null) {
      return { isCueCard: false, topic: null, bullets: null };
    }
    var trimmed = String(text).trim();
    if (!trimmed) {
      return { isCueCard: false, topic: null, bullets: null };
    }

    var lines = trimmed.split(/\r?\n/);
    var firstLine = '';
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].trim()) { firstLine = lines[i].trim(); break; }
    }
    if (!OPENING_RE.test(firstLine)) {
      return { isCueCard: false, topic: null, bullets: null };
    }

    if (!YOU_SHOULD_RE.test(trimmed)) {
      return { isCueCard: false, topic: null, bullets: null };
    }

    var bullets = [];
    for (var j = 0; j < lines.length; j++) {
      var stripped = lines[j].trim();
      if (BULLET_RE.test(stripped)) {
        bullets.push(stripped.replace(BULLET_RE, '').trim());
      }
    }
    if (bullets.length < 2) {
      return { isCueCard: false, topic: null, bullets: null };
    }

    return { isCueCard: true, topic: firstLine, bullets: bullets };
  }

  /**
   * Parse the textarea contents into a list of question objects/strings
   * ready to POST to `/sessions/{id}/questions/custom`.
   *
   * @param {string} text — raw textarea contents
   * @param {'auto'|'single'|'cue_card'} mode — toggle setting (L1)
   * @returns {Array<string|object>} — heterogeneous list, accepted by
   *     the (Sprint 14.4) backend `_CustomQBody`. Single-question
   *     entries stay as plain strings for L8 backward compat with
   *     pre-Sprint-14.4 clients.
   */
  function parseCustomQuestions(text, mode) {
    var raw = (text == null ? '' : String(text)).trim();

    if (mode === 'cue_card') {
      // User explicitly forced cue-card mode. Use the detector's
      // structured output when the heuristic matches; otherwise fall
      // back to a "best effort" cue card with empty bullets (the
      // backend will store it; the user knows their text best).
      var forced = detectCueCard(raw);
      var firstLine = raw.split(/\r?\n/)[0].trim();
      return [{
        type:    'cue_card',
        prompt:  raw,
        topic:   forced.topic || firstLine,
        bullets: forced.bullets || [],
      }];
    }

    if (mode === 'single') {
      // L8 — preserve the legacy naive-split path verbatim, including
      // the historical .slice(0, 10) cap.
      return _naiveSplitToSingle(raw);
    }

    // mode === 'auto' (default) — heuristic decides.
    var det = detectCueCard(raw);
    if (det.isCueCard) {
      return [{
        type:    'cue_card',
        prompt:  raw,
        topic:   det.topic,
        bullets: det.bullets,
      }];
    }
    return _naiveSplitToSingle(raw);
  }

  function _naiveSplitToSingle(raw) {
    if (!raw) return [];
    var lines = raw.split(/\r?\n/);
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].trim();
      if (t) out.push(t);
      if (out.length >= 10) break;   // legacy cap — Andy L8
    }
    return out;
  }

  /**
   * Sprint 14.6.4 — extract the first sentence/line from a Part 2
   * paste so the AI gen endpoint receives a clean topic statement.
   *
   * Andy 2026-05-23 empirical bug: users paste a full cue card on a
   * single line (no `\n`, no `-` bullets), Sprint 14.4 detection
   * fails, Sprint 14.6.2 fallback used `lines[0]` = the entire
   * pre-formed cue card as the trigger. The AI model received a
   * cue card and "generated" a different one → user-visible
   * inconsistency.
   *
   * Updated L7 contract (refined from the empirical Andy 2026-05-23
   * paste, which was 162 chars — UNDER the original 200-char threshold
   * — but still pre-formed cue card needing first-sentence extraction):
   *
   *   1. Trim. Empty / whitespace-only input → "".
   *   2. If the input has any `\n`, return the first non-empty
   *      trimmed line. (Multi-line paste short-circuits.)
   *   3. Single line: search for the first ". " (period + space)
   *      within the first 200 characters.
   *      - Found → return the substring up to and including the
   *        period. This handles Andy's empirical case at any
   *        length: a single line with "Describe X. You should say..."
   *        becomes "Describe X." regardless of total length.
   *   4. No "." found AND length ≤200 → return the trimmed text
   *      as-is. (Normal short trigger like "Describe a person.")
   *   5. No "." found AND length >200 → hard cap at 200 chars.
   *
   * Pure function — no DOM, no module-system magic.
   *
   * @param {string} text — raw paste contents
   * @returns {string} the trigger to send to /sessions/cuecard/generate
   */
  function extractFirstLineAsTrigger(text) {
    if (text == null) return '';
    var trimmed = String(text).trim();
    if (!trimmed) return '';

    // 2 — multi-line paste: take the first non-empty trimmed line.
    if (trimmed.indexOf('\n') !== -1) {
      var lines = trimmed.split(/\r?\n/);
      for (var i = 0; i < lines.length; i++) {
        var t = lines[i].trim();
        if (t) return t;
      }
      return '';
    }

    // 3 — single line: prefer truncation at the first ". " inside the
    // 200-char window. This is the fix for Andy's empirical bug —
    // pastes UNDER 200 chars still had pre-formed cue cards as the
    // trigger; we now strip everything after the first sentence
    // boundary regardless of total length.
    var window200 = trimmed.length > 200 ? trimmed.substring(0, 200) : trimmed;
    var periodIdx = window200.indexOf('. ');
    if (periodIdx > 0) {
      return trimmed.substring(0, periodIdx + 1);   // include trailing period
    }

    // 4 — short single line, no sentence boundary: pass through.
    if (trimmed.length <= 200) {
      return trimmed;
    }

    // 5 — long single line, no sentence boundary in the 200-char
    // window: hard cap so the AI gen prompt stays bounded.
    return window200;
  }

  /**
   * Sprint 14.6.2 — part-driven router. Replaces the Sprint 14.4
   * three-option toggle ("auto" / "single" / "cue_card") which Andy's
   * 2026-05-22 17:03 screenshot showed as redundant with the existing
   * Part 1/2/3 selector.
   *
   * Routing (Andy locks L2 + L3):
   *   - Part 1 + Part 3 → always naive single-question split.
   *   - Part 2 + paste matches detectCueCard heuristic → use the
   *     paste as the full cue card (source: "user_pasted").
   *   - Part 2 + paste fails the heuristic (incl. 1-line trigger like
   *     "Describe your favourite hobby.") → call backend AI gen
   *     endpoint with the first non-empty line as the trigger; treat
   *     additional lines as ignorable context per L4.
   *
   * @param {string} text — raw textarea contents
   * @param {number} partNum — 1, 2, or 3 (from the Part selector)
   * @param {{api?: {post: Function}}} [opts] — testing seam.
   *     Sprint 14.6.3 — opts.api replaces the Sprint 14.6.2 opts.fetch
   *     seam because the production code path now goes through
   *     `window.api.post(path, body)` (which prepends the Railway
   *     backend base URL). Tests inject a stub via `opts.api`.
   * @returns {Promise<Array<string|object>>}
   */
  async function parseCustomQuestionsByPart(text, partNum, opts) {
    var raw = (text == null ? '' : String(text)).trim();

    if (partNum === 1 || partNum === 3) {
      return _naiveSplitToSingle(raw);
    }

    if (partNum !== 2) {
      throw new Error('parseCustomQuestionsByPart: unsupported partNum ' + partNum);
    }

    // Sprint 14.6.4 Part 2 routing simplification (Pattern #35):
    //
    //   Case A — multi-line *structured* cue card (Sprint 14.4
    //   heuristic matches: opening keyword + "you should say" +
    //   ≥2 bullet lines). This is the power-user path: the paste
    //   already has the shape the Part 2 state machine needs, so
    //   we bypass AI gen and use it verbatim. `source` was renamed
    //   to `user_pasted_multiline` (Sprint 14.6.4 L8) to signal
    //   that this is now the *secondary* path; the primary route
    //   is the AI-gen branch below.
    //
    //   Case B — everything else: extract the first sentence as the
    //   AI gen trigger. Sprint 14.6.2 originally took `lines[0]`,
    //   which broke on Andy's 2026-05-23 paste (long single line
    //   with internal periods → the whole pre-formed cue card was
    //   sent as the trigger, and the model regenerated something
    //   different). `extractFirstLineAsTrigger` truncates at the
    //   first sentence boundary so the model receives a clean topic
    //   statement (L7).
    var det = detectCueCard(raw);
    if (det.isCueCard) {
      return [{
        type:    'cue_card',
        prompt:  raw,
        topic:   det.topic,
        bullets: det.bullets,
        source:  'user_pasted_multiline',
      }];
    }

    var trigger = extractFirstLineAsTrigger(raw);
    if (!trigger) {
      throw new Error('Vui lòng nhập ít nhất 1 dòng cho Part 2');
    }

    // Sprint 14.6.3 — Route through `window.api.post` instead of a
    // raw `fetch('/sessions/...')`. The raw-fetch path resolved
    // against the Vercel frontend domain in production
    // (www.averlearning.com), producing a 404 HTML page; api.post
    // prepends the Railway backend base URL (`_API_BASE` in api.js)
    // so the call lands on the actual FastAPI server. The opts.api
    // seam preserves testability — tests inject a stub api object
    // with a .post(path, body) async method.
    var apiPost = (opts && opts.api && typeof opts.api.post === 'function')
      ? opts.api.post
      : (typeof window !== 'undefined' && window.api && typeof window.api.post === 'function')
        ? window.api.post.bind(window.api)
        : null;

    if (!apiPost) {
      throw new Error('window.api.post not available — ensure api.js is loaded before cue-card-detector.js');
    }

    // api.post returns the parsed JSON on 2xx, or throws an Error
    // with .status + .detail attached (api.js _apiRequest semantics).
    // The Sprint 14.6.2 caller in speaking.html already wraps this
    // in try/catch and surfaces `err.message` — keep the throw shape
    // backward-compatible so we don't break the existing UX.
    var payload;
    try {
      payload = await apiPost('/sessions/cuecard/generate', { trigger: trigger });
    } catch (e) {
      // Pass through if the error already carries .status (api.js
      // already populated it). Otherwise wrap with the VN fallback
      // so the user sees an actionable message even on network noise.
      if (e && typeof e.status === 'number') {
        // api.js sets message from detail.message when present, else
        // "HTTP <status>"; for the latter we substitute the VN copy
        // so the panel reads naturally.
        if (!e.message || /^HTTP\s+\d+$/.test(e.message)) {
          e.message = 'Không thể tạo cue card. Hãy thử paste cue card đầy đủ.';
        }
        throw e;
      }
      var wrapped = new Error('Không thể tạo cue card. Hãy thử paste cue card đầy đủ.');
      wrapped.cause = e;
      throw wrapped;
    }

    // Sprint 14.4 backend `_CustomQBody` accepts {type, prompt, topic,
    // bullets}; the AI-gen endpoint already returns exactly that
    // shape so we forward it verbatim. The extra `trigger` + `source`
    // keys are ignored by Pydantic (CueCardQuestion is permissive on
    // unknown fields — they would just drop).
    return [{
      type:    'cue_card',
      prompt:  payload.prompt,
      topic:   payload.topic,
      bullets: payload.bullets || [],
      source:  payload.source || 'ai_generated',
      trigger: payload.trigger || trigger,
    }];
  }

  var api = {
    detectCueCard:        detectCueCard,
    parseCustomQuestions: parseCustomQuestions,       // Sprint 14.4 (deprecated — kept for L10 backward compat)
    parseCustomQuestionsByPart: parseCustomQuestionsByPart,  // Sprint 14.6.2
    extractFirstLineAsTrigger:  extractFirstLineAsTrigger,   // Sprint 14.6.4
    // Exported for test harness only; not part of the public API.
    _OPENING_RE:    OPENING_RE,
    _YOU_SHOULD_RE: YOU_SHOULD_RE,
    _BULLET_RE:     BULLET_RE,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (typeof window !== 'undefined') {
    window.CueCardDetector = api;
  }
})();
