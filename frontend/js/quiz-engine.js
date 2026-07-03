/**
 * frontend/js/quiz-engine.js — Quick-Check Adaptive Mastery engine (Pha 2).
 *
 * Pure logic (no DOM) so it is unit-testable under `node --test`. The page
 * (quiz.html) renders widgets + reads engine output. Implements the §4/§6 loop:
 * queue of not-yet-mastered words, rotate-on-skill variant pick, instant client
 * grading, mastery = `correct_to_master` DISTINCT skills + ≥1 production (text)
 * answer + reversal-confirm anti-guess, cooldown spacing, max-attempts cap →
 * carry-over. Progress (attempts + per-word snapshots) is drained to the backend.
 *
 * ESM with a CommonJS fallback so both the browser and node tests can load it.
 */

// ── Grading helpers ──────────────────────────────────────────────────

export function normalizeText(s, opts) {
  var caseSensitive = opts && opts.caseSensitive;
  var t = String(s == null ? '' : s).trim().replace(/\s+/g, ' ');
  // strip surrounding quotes/punctuation
  t = t.replace(/^[\s"'.,;:!?(){}\[\]]+|[\s"'.,;:!?(){}\[\]]+$/g, '');
  return caseSensitive ? t : t.toLowerCase();
}

/**
 * Grade one question against a user answer.
 *  - choice/syllable: answer = selected 0-based index (number)
 *  - boolean:         answer = boolean
 *  - text:            answer = typed string
 * Returns true/false.
 */
export function gradeQuestion(q, answer) {
  switch (q.input) {
    case 'choice':
    case 'syllable':
      return typeof answer === 'number' && answer === q.answer;
    case 'boolean':
      return Boolean(answer) === (q.answer === 1 || q.answer === true);
    case 'text':
      return gradeText(q, answer).correct;
    default:
      return false;
  }
}

/**
 * Grade a text answer with detail: {correct, exact, canonical}.
 *  - exact:     true when the answer matched an accepted form verbatim (normalized)
 *  - canonical: the accepted form that matched (original casing, for display) — so a
 *               fuzzy accept can show the learner the correct spelling
 * Exact is tried first, so anything that passed before still passes.
 */
export function gradeText(q, answer) {
  var accept = Array.isArray(q.accept) ? q.accept : [];
  var norm = normalizeText(answer, { caseSensitive: q.case_sensitive });
  for (var i = 0; i < accept.length; i++) {
    if (normalizeText(accept[i], { caseSensitive: q.case_sensitive }) === norm) {
      return { correct: true, exact: true, canonical: accept[i] };
    }
  }
  // Bounded typo tolerance for RECALL production (§Fix E): accept an answer one edit
  // away from a canonical form, but ONLY when the target is long enough that a single
  // edit is unambiguous, the FIRST character matches (a leading-char edit is what
  // creates dangerous minimal pairs like affect/effect), and never for
  // orthography-graded types.
  if (!textFuzzyAllowed(q)) return { correct: false, exact: false, canonical: null };
  for (var j = 0; j < accept.length; j++) {
    var na = normalizeText(accept[j], { caseSensitive: q.case_sensitive });
    if (na.length >= FUZZY_MIN_LEN && norm.charAt(0) === na.charAt(0)
        && withinEditDistance1(na, norm)) {
      return { correct: true, exact: false, canonical: accept[j] };
    }
  }
  return { correct: false, exact: false, canonical: null };
}

// Minimum canonical-answer length for typo tolerance: below this a single edit is
// too ambiguous (e.g. cat→cut→cot), so short answers stay exact-match only.
var FUZZY_MIN_LEN = 5;

// Fuzzy text matching is OFF when the question tests exact orthography (spelling /
// missing_letters), when it is case-sensitive (implies precise), or when the author
// opts out (exact:true / fuzzy:false). Recall types (e.g. gap_text) keep it ON.
function textFuzzyAllowed(q) {
  if (q.case_sensitive) return false;
  if (q.exact === true || q.fuzzy === false) return false;
  var t = String(q.type || '');
  return t !== 'spelling' && t !== 'missing_letters';
}

// True iff the Levenshtein distance between a and b is ≤ 1 (one insertion,
// deletion, or substitution). Single bounded pass — no full DP matrix.
function withinEditDistance1(a, b) {
  var la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  if (la > lb) { var t = a; a = b; b = t; var tl = la; la = lb; lb = tl; }
  // now la <= lb and lb - la ∈ {0, 1}
  var i = 0, j = 0, seenDiff = false;
  while (i < la && j < lb) {
    if (a.charAt(i) === b.charAt(j)) { i++; j++; continue; }
    if (seenDiff) return false;   // a second difference → distance ≥ 2
    seenDiff = true;
    if (la === lb) { i++; j++; }  // substitution
    else { j++; }                 // insertion in the longer string
  }
  return true;                    // ≤1 diff found (trailing char, if any, is the 1)
}

function countsToward(q) {
  return q.counts_toward_mastery !== false;
}
function isProduction(q) {
  return q.input === 'text';
}

// ── Engine ───────────────────────────────────────────────────────────

export function createEngine(bank, options) {
  var opts = options || {};
  // Optional seeded RNG (opts.seed, e.g. the session id). When present, the word
  // ENTRY order and variant tie-breaks are randomized deterministically per seed so
  // two students — or the same student retrying — don't get an identical question
  // sequence. When absent (unit tests), behavior stays deterministic file-order.
  var rng = makeRng(opts.seed);
  function pickOne(arr) { return rng ? arr[Math.floor(rng() * arr.length)] : arr[0]; }
  // Accept either {meta, questions} or the raw API shape {bank:{...,meta}, questions}
  // so imported META controls (correct_to_master, cooldown, …) are always honored.
  var meta = (bank && (bank.meta || (bank.bank && bank.bank.meta))) || {};
  var questions = (bank && bank.questions) || [];

  var CORRECT_TO_MASTER = num(meta.correct_to_master, 2);
  var REQUIRE_DISTINCT = meta.require_distinct_skill !== false;
  var REQUIRE_PRODUCTION = meta.require_production_to_master !== false;
  var PROVISIONAL_MCQ = meta.provisional_on_single_mcq !== false;
  var CONFIRM_REVERSAL = meta.confirm_by_reversal !== false;
  var RESET_ON_CONFIRM_FAIL = meta.reset_provisional_on_confirm_fail !== false;
  var COOLDOWN = num(meta.cooldown, 2);
  var MAX_ATTEMPTS = num(meta.max_attempts_per_word, 8);

  // pools: item_key → [questions]. Only inputs the player can RENDER + GRADE are
  // pooled — a bank may include input:match (schema-supported, generator-deferred)
  // which would otherwise always grade wrong and trap the word in carry-over.
  // Skipping them means such questions are simply never served; a word whose only
  // questions are unsupported drops out of `order` (not counted, not asked).
  var SUPPORTED_INPUTS = { choice: 1, text: 1, boolean: 1, syllable: 1 };
  var pools = {};
  var order = [];
  questions.forEach(function (q) {
    if (!SUPPORTED_INPUTS[q.input]) return;
    if (!pools[q.item_key]) { pools[q.item_key] = []; order.push(q.item_key); }
    pools[q.item_key].push(q);
  });
  // Randomize word entry order when seeded (the cooldown/rotate loop still governs
  // mid-session spacing; this only decides where each word STARTS in the queue).
  if (rng) shuffleInPlace(order, rng);

  var resumeByKey = {};
  (opts.resume || []).forEach(function (w) { resumeByKey[w.item_key] = w; });

  // per-word runtime state
  var words = {};
  order.forEach(function (key) {
    var r = resumeByKey[key] || {};
    var passed = new Set(Array.isArray(r.skills_passed) ? r.skills_passed : []);
    words[key] = {
      key: key,
      status: 'testing',
      passedSkills: passed,
      // credits = count of confirmed counting-corrects (for require_distinct_skill:false
      // banks, where repeats at the same skill should still count). Falls back to the
      // distinct-skill count when not persisted.
      credits: num(r.credit_count, passed.size),
      productionDone: Boolean(r.production_done),
      // Rehydrate the unconfirmed-MCQ credit so a resumed provisional word can
      // still be confirmed+mastered by a later production answer (carry-over truth).
      provisional: r.provisional_skill ? { skill: String(r.provisional_skill) } : null,
      usedQids: new Set(),
      attempts: 0,
      correct_count: num(r.correct_count, 0),
      wrong_count: num(r.wrong_count, 0),
      first_try_correct: typeof r.first_try_correct === 'boolean' ? r.first_try_correct : null,
      is_difficult: Boolean(r.is_difficult),
      dirty: false,
    };
    // A resumed already-mastered word stays mastered (don't re-ask it).
    if (isMasteredWord(words[key])) words[key].status = 'mastered';
  });

  var queue = order.filter(function (k) { return words[k].status !== 'mastered'; });
  var recent = [];                 // recently-asked keys (cooldown)
  var current = null;              // {word, q, startedAt}
  var attemptsBatch = [];
  var counters = { total: 0, correct: 0, wrong: 0 };
  var totalWords = order.length;

  function isMasteredWord(w) {
    // require_distinct_skill: true → need correct_to_master DISTINCT skills;
    // false → need correct_to_master confirmed corrects (credits), repeats OK.
    var have = REQUIRE_DISTINCT ? w.passedSkills.size : w.credits;
    if (have < CORRECT_TO_MASTER) return false;
    if (REQUIRE_PRODUCTION && !w.productionDone) return false;
    return true;
  }

  // pick the next word respecting cooldown (skip words asked within last COOLDOWN
  // picks when other words remain), else front of queue.
  function pickWordKey() {
    if (!queue.length) return null;
    for (var i = 0; i < queue.length; i++) {
      var k = queue[i];
      if (recent.indexOf(k) === -1 || queue.length <= COOLDOWN) {
        return k;
      }
    }
    return queue[0];   // all in cooldown but nothing else → front
  }

  // pick a variant for a word: prefer an UNUSED counts-toward skill not already
  // passed; then any unused; then reuse (prefer production), to keep re-asking.
  function pickVariant(w) {
    var pool = pools[w.key] || [];
    var unused = pool.filter(function (q) { return !w.usedQids.has(q.qid); });
    var counts = unused.filter(countsToward);

    // when confirming a provisional, prefer a DIFFERENT skill (reversal) or a text.
    // pickOne randomizes WITHIN a priority tier when seeded (else takes the first),
    // so the ranking is preserved but ties don't always resolve to the same variant.
    if (w.provisional && CONFIRM_REVERSAL) {
      var confirmers = counts.filter(function (q) {
        return isProduction(q) || q.skill !== w.provisional.skill;
      });
      var prodFirst = confirmers.filter(isProduction);
      if (prodFirst.length) return pickOne(prodFirst);
      if (confirmers.length) return pickOne(confirmers);
    }
    // prefer a skill not yet passed
    var freshSkill = counts.filter(function (q) { return !w.passedSkills.has(q.skill); });
    if (freshSkill.length) return pickOne(freshSkill);
    if (counts.length) return pickOne(counts);
    if (unused.length) return pickOne(unused);   // an enrich question (stress/ipa…)

    // all used → reuse, prefer production (forces recall), else first.
    var prod = pool.filter(isProduction);
    if (REQUIRE_PRODUCTION && !w.productionDone && prod.length) return pickOne(prod);
    return pool[0] || null;
  }

  function next() {
    var key = pickWordKey();
    if (key == null) { current = null; return null; }
    var w = words[key];
    var q = pickVariant(w);
    if (!q) {            // pool exhausted unexpectedly → drop from queue
      dropFromQueue(key);
      return next();
    }
    current = { word: w, q: q, startedAt: nowMs() };
    return { question: q, item_key: key };
  }

  function submit(answer) {
    if (!current) return null;
    var w = current.word, q = current.q;
    // For text, grade with detail so a fuzzy (typo-tolerant) accept can surface the
    // canonical spelling to the learner. Other inputs stay boolean-graded.
    var corrected = null, correct;
    if (q.input === 'text') {
      var gt = gradeText(q, answer);
      correct = gt.correct;
      if (correct && !gt.exact) corrected = gt.canonical;
    } else {
      correct = gradeQuestion(q, answer);
    }
    w.attempts += 1;
    w.usedQids.add(q.qid);
    w.dirty = true;
    counters.total += 1;

    if (w.first_try_correct === null) w.first_try_correct = correct;

    attemptsBatch.push({
      client_id: uuid(),   // idempotency key — dedupes a retried/keepalive re-send
      item_key: w.key, qid: q.qid, skill: q.skill, type: q.type, subtype: q.subtype || null,
      is_correct: correct, answer_given: serializeAnswer(answer),
      response_time_ms: Math.max(0, nowMs() - current.startedAt), attempt_no: w.attempts,
    });

    if (correct) {
      counters.correct += 1; w.correct_count += 1;
      if (countsToward(q)) applyCorrectCredit(w, q);
    } else {
      counters.wrong += 1; w.wrong_count += 1;
      if (countsToward(q) && RESET_ON_CONFIRM_FAIL) w.provisional = null;  // reset on wrong
    }

    if (w.attempts > 2) w.is_difficult = true;

    var mastered = isMasteredWord(w);
    var exhausted = !mastered && w.attempts >= MAX_ATTEMPTS;
    recordRecent(w.key);

    if (mastered) { w.status = 'mastered'; dropFromQueue(w.key); }
    else if (exhausted) { w.status = 'carried_over'; w.attempts_to_master = null; dropFromQueue(w.key); }
    else { w.status = w.provisional ? 'provisional' : 'testing'; rotateToBack(w.key); }

    if (mastered) w.attempts_to_master = w.attempts;

    current = null;
    return {
      correct: correct,
      corrected: corrected,   // canonical spelling when a typo-tolerant match was accepted
      explain: q.explain || '',
      mastered: mastered,
      exhausted: exhausted,
      item_key: w.key,
      done: queue.length === 0,
      progress: progress(),
    };
  }

  // credit model (§6.A): production confirms immediately + counts; a lone MCQ
  // correct is provisional; a different-skill recognition (or a production)
  // confirms it. Distinct skills tracked in passedSkills (a Set).
  function credit(w, skill) { w.passedSkills.add(skill); w.credits += 1; }

  function applyCorrectCredit(w, q) {
    if (isProduction(q)) {
      w.productionDone = true;
      credit(w, q.skill);
      if (w.provisional) { credit(w, w.provisional.skill); w.provisional = null; }
      return;
    }
    if (!PROVISIONAL_MCQ) { credit(w, q.skill); return; }
    if (w.provisional && (!CONFIRM_REVERSAL || w.provisional.skill !== q.skill)) {
      credit(w, w.provisional.skill);
      credit(w, q.skill);
      w.provisional = null;
    } else if (!w.provisional) {
      w.provisional = { skill: q.skill };
    }
    // same-skill provisional repeat → no new credit (anti-guess)
  }

  function dropFromQueue(key) {
    var i = queue.indexOf(key); if (i !== -1) queue.splice(i, 1);
  }
  function rotateToBack(key) {
    var i = queue.indexOf(key); if (i !== -1) { queue.splice(i, 1); queue.push(key); }
  }
  function recordRecent(key) {
    recent.push(key); while (recent.length > COOLDOWN) recent.shift();
  }

  function progress() {
    var mastered = order.filter(function (k) { return words[k].status === 'mastered'; }).length;
    return { mastered: mastered, total: totalWords, remaining: queue.length };
  }

  // Drain progress to POST to the backend (attempts since last drain + dirty word snapshots).
  function drainBatch() {
    var attempts = attemptsBatch; attemptsBatch = [];
    var wordStats = order.filter(function (k) { return words[k].dirty; }).map(function (k) {
      var w = words[k]; w.dirty = false;
      return {
        item_key: k, correct_count: w.correct_count, wrong_count: w.wrong_count,
        first_try_correct: w.first_try_correct, attempts_to_master: w.attempts_to_master || null,
        status: w.status, is_difficult: w.is_difficult,
        skills_passed: Array.from(w.passedSkills),
        // carry-over truth: persist the unconfirmed-MCQ skill, production flag, and
        // credit count so a resumed session rehydrates full mastery state (incl.
        // require_distinct_skill:false banks + already-mastered words).
        provisional_skill: w.provisional ? w.provisional.skill : null,
        production_done: w.productionDone,
        credit_count: w.credits,
      };
    });
    return { attempts: attempts, word_stats: wordStats };
  }

  function summary() {
    var mastered = [], carried = [], hardest = null;
    order.forEach(function (k) {
      var w = words[k];
      if (w.status === 'mastered') mastered.push(k);
      else carried.push(k);
      if (!hardest || w.attempts > hardest.attempts) hardest = { key: k, attempts: w.attempts };
    });
    return {
      total: totalWords, mastered: mastered.length, carried_over: carried.length,
      carried_keys: carried, hardest: hardest,
      total_questions: counters.total, total_correct: counters.correct, total_wrong: counters.wrong,
    };
  }

  return {
    next: next, submit: submit, progress: progress, drainBatch: drainBatch,
    summary: summary,
    _state: function () { return { words: words, queue: queue }; },  // test introspection
  };
}

// ── small utils ──────────────────────────────────────────────────────

function num(v, d) { var n = parseInt(v, 10); return isNaN(n) ? d : n; }
// Seeded PRNG (xmur3 hash → mulberry32). Returns null for a null/undefined seed so
// callers stay deterministic (file order, first-match variants) when unseeded — the
// unit tests rely on this. Deterministic per seed so a resumed session is stable.
function makeRng(seed) {
  if (seed == null) return null;
  var s = String(seed), h = 1779033703 ^ s.length;
  for (var i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19);
  }
  var a = h >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffleInPlace(arr, rng) {
  for (var i = arr.length - 1; i > 0; i--) {
    var j = Math.floor(rng() * (i + 1));
    var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}
function uuid() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch (e) { /* fall through */ }
  // RFC4122 v4 fallback — must stay UUID-shaped (client_id is a UUID column).
  var b = new Array(16);
  try {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      var arr = new Uint8Array(16); crypto.getRandomValues(arr);
      for (var i = 0; i < 16; i++) b[i] = arr[i];
    } else {
      for (var j = 0; j < 16; j++) b[j] = Math.floor(Math.random() * 256);
    }
  } catch (e2) {
    for (var k = 0; k < 16; k++) b[k] = Math.floor(Math.random() * 256);
  }
  b[6] = (b[6] & 0x0f) | 0x40;   // version 4
  b[8] = (b[8] & 0x3f) | 0x80;   // variant 10xx
  var h = b.map(function (x) { return (x + 0x100).toString(16).slice(1); });
  return h.slice(0, 4).join('') + '-' + h.slice(4, 6).join('') + '-' + h.slice(6, 8).join('') +
         '-' + h.slice(8, 10).join('') + '-' + h.slice(10, 16).join('');
}
function nowMs() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }
function serializeAnswer(a) {
  if (a == null) return '';
  if (typeof a === 'object') { try { return JSON.stringify(a); } catch (e) { return String(a); } }
  return String(a);
}
