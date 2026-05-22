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

  var api = {
    detectCueCard:        detectCueCard,
    parseCustomQuestions: parseCustomQuestions,
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
