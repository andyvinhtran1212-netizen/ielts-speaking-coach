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
    case 'text': {
      var accept = Array.isArray(q.accept) ? q.accept : [];
      var norm = normalizeText(answer, { caseSensitive: q.case_sensitive });
      return accept.some(function (a) {
        return normalizeText(a, { caseSensitive: q.case_sensitive }) === norm;
      });
    }
    default:
      return false;
  }
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

  // pools: item_key → [questions]
  var pools = {};
  var order = [];
  questions.forEach(function (q) {
    if (!pools[q.item_key]) { pools[q.item_key] = []; order.push(q.item_key); }
    pools[q.item_key].push(q);
  });

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
    if (w.provisional && CONFIRM_REVERSAL) {
      var confirmers = counts.filter(function (q) {
        return isProduction(q) || q.skill !== w.provisional.skill;
      });
      var prodFirst = confirmers.filter(isProduction);
      if (prodFirst.length) return prodFirst[0];
      if (confirmers.length) return confirmers[0];
    }
    // prefer a skill not yet passed
    var freshSkill = counts.filter(function (q) { return !w.passedSkills.has(q.skill); });
    if (freshSkill.length) return freshSkill[0];
    if (counts.length) return counts[0];
    if (unused.length) return unused[0];   // an enrich question (stress/ipa…)

    // all used → reuse, prefer production (forces recall), else first.
    var prod = pool.filter(isProduction);
    if (REQUIRE_PRODUCTION && !w.productionDone && prod.length) return prod[0];
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
    var correct = gradeQuestion(q, answer);
    w.attempts += 1;
    w.usedQids.add(q.qid);
    w.dirty = true;
    counters.total += 1;

    if (w.first_try_correct === null) w.first_try_correct = correct;

    attemptsBatch.push({
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
function nowMs() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }
function serializeAnswer(a) {
  if (a == null) return '';
  if (typeof a === 'object') { try { return JSON.stringify(a); } catch (e) { return String(a); } }
  return String(a);
}
