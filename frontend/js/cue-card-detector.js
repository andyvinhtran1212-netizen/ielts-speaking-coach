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
   * @param {{fetch?: typeof fetch}} [opts] — testing seam
   * @returns {Promise<Array<string|object>>}
   */
  async function parseCustomQuestionsByPart(text, partNum, opts) {
    var raw = (text == null ? '' : String(text)).trim();
    var fetchImpl = (opts && opts.fetch) || (typeof fetch !== 'undefined' ? fetch : null);

    if (partNum === 1 || partNum === 3) {
      return _naiveSplitToSingle(raw);
    }

    if (partNum !== 2) {
      throw new Error('parseCustomQuestionsByPart: unsupported partNum ' + partNum);
    }

    // Part 2 — case A: full cue card pasted (Sprint 14.4 heuristic).
    var det = detectCueCard(raw);
    if (det.isCueCard) {
      return [{
        type:    'cue_card',
        prompt:  raw,
        topic:   det.topic,
        bullets: det.bullets,
        source:  'user_pasted',
      }];
    }

    // Part 2 — case B: 1-line trigger (or multi-line non-cue-card; per
    // L4 we use the first non-empty line as the trigger and ignore
    // the rest — the alternative is a confusing reject UX).
    var lines = raw.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    if (lines.length === 0) {
      throw new Error('Vui lòng nhập ít nhất 1 dòng cho Part 2');
    }
    var trigger = lines[0];

    if (!fetchImpl) {
      throw new Error('parseCustomQuestionsByPart: fetch unavailable for AI cue-card gen');
    }

    var resp = await fetchImpl('/sessions/cuecard/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ trigger: trigger }),
    });

    if (!resp.ok) {
      var detail = {};
      try { detail = await resp.json(); } catch (_) {}
      var msg = (detail && detail.detail && detail.detail.message)
        || 'Không thể tạo cue card. Hãy thử paste cue card đầy đủ.';
      var err = new Error(msg);
      err.status = resp.status;
      err.detail = detail.detail || detail;
      throw err;
    }

    var payload = await resp.json();
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
