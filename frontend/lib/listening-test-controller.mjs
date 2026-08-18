import { corePlayerUrl } from './core-player-affinity.mjs';

const RETRY_DELAYS = Object.freeze([400, 1200, 3000]);
const LISTENING_ORIGINS = new Set(['full', 'mini', 'drill', 'practice', 'mock']);
const LISTENING_GAP_TOKEN_RE = /_{2,}|…+|\.{4,}/;
const LISTENING_BOLD_RE = /\*\*([^*]+)\*\*/g;
const LISTENING_ITALIC_RE = /\*([^*\n]+)\*/g;

/**
 * Split the first authored blank token without interpreting the surrounding
 * prompt as HTML. React can then place the real input between both text halves
 * while preserving the legacy player's semantic position.
 */
export function splitListeningGapPrompt(prompt) {
  const text = String(prompt ?? '');
  const match = LISTENING_GAP_TOKEN_RE.exec(text);
  if (!match) return null;
  return Object.freeze({
    before: text.slice(0, match.index),
    after: text.slice(match.index + match[0].length),
  });
}

/**
 * Parse the deliberately small markdown subset supported by the legacy test
 * player. Tokens remain plain text for React to escape; no authored HTML is
 * ever injected. When `insertGap` is true, the first blank becomes a typed gap
 * token (including when the blank sits inside bold/italic emphasis), otherwise
 * a gap is appended after one space just like legacy `renderGapPrompt()`.
 */
export function listeningInlineTokens(raw, { insertGap = false } = {}) {
  const text = String(raw ?? '');
  const tokens = [];
  const boldValues = [];
  // Legacy runs bold replacement first, then italic over that output. Replace
  // bold spans with collision-free sentinels so an outer italic span can cross
  // them, then expand into typed React tokens instead of trusting HTML.
  let sentinelCode = 0xe000;
  while (sentinelCode < 0xf8fe
      && (text.includes(String.fromCharCode(sentinelCode))
        || text.includes(String.fromCharCode(sentinelCode + 1)))) sentinelCode += 2;
  const sentinelOpen = String.fromCharCode(sentinelCode);
  const sentinelClose = String.fromCharCode(sentinelCode + 1);
  const staged = text.replace(LISTENING_BOLD_RE, (_whole, value) => {
    const index = boldValues.push(value) - 1;
    return `${sentinelOpen}${index}${sentinelClose}`;
  });
  const sentinelRe = new RegExp(`${sentinelOpen}(\\d+)${sentinelClose}`, 'g');
  const expand = (chunk, em) => {
    let at = 0;
    for (const match of chunk.matchAll(sentinelRe)) {
      if (match.index > at) {
        tokens.push({ type: 'text', text: chunk.slice(at, match.index), emphasis: em ? 'em' : null });
      }
      tokens.push({ type: 'text', text: boldValues[Number(match[1])], emphasis: em ? 'strong-em' : 'strong' });
      at = match.index + match[0].length;
    }
    if (at < chunk.length || (!chunk.length && !tokens.length)) {
      tokens.push({ type: 'text', text: chunk.slice(at), emphasis: em ? 'em' : null });
    }
  };
  let cursor = 0;
  for (const match of staged.matchAll(LISTENING_ITALIC_RE)) {
    if (match.index > cursor) expand(staged.slice(cursor, match.index), false);
    expand(match[1], true);
    cursor = match.index + match[0].length;
  }
  if (cursor < staged.length || !tokens.length) expand(staged.slice(cursor), false);
  if (!insertGap) return tokens;

  const withGap = [];
  let inserted = false;
  for (const token of tokens) {
    const split = inserted ? null : splitListeningGapPrompt(token.text);
    if (!split) {
      withGap.push(token);
      continue;
    }
    if (split.before) withGap.push({ ...token, text: split.before });
    withGap.push({ type: 'gap', emphasis: token.emphasis });
    if (split.after) withGap.push({ ...token, text: split.after });
    inserted = true;
  }
  if (!inserted) {
    withGap.push({ type: 'text', text: ' ', emphasis: null });
    withGap.push({ type: 'gap', emphasis: null });
  }
  return withGap;
}

/**
 * Preserve the converter's mixed representation for table cells: bare gap
 * segments continue the current sentence, while a gap that owns its prefix or
 * prose after a gap with a suffix starts a new logical statement.
 */
export function listeningTableCellLines(segments) {
  const lines = [];
  let current = null;
  let previous = null;
  for (const segment of Array.isArray(segments) ? segments : []) {
    const isGap = !!segment && typeof segment === 'object' && segment.q_num != null;
    const ownsItsLead = isGap && String(segment.prefix || '').trim();
    const followsClosedGap = !isGap && previous && typeof previous === 'object'
      && previous.q_num != null && String(previous.suffix || '').trim();
    if (current === null || ownsItsLead || followsClosedGap) {
      current = [];
      lines.push(current);
    }
    current.push(segment);
    previous = segment;
  }
  return lines;
}

export function listeningTestParams(search) {
  const params = new URLSearchParams(search || '');
  const testId = (params.get('id') || '').trim();
  if (!testId) throw new Error('missing-listening-test-identity');
  return Object.freeze({
    testId,
    classItem: (params.get('class_item') || '').trim() || null,
    from: (params.get('from') || '').trim() || null,
    sittingId: (params.get('sitting_id') || '').trim() || null,
    mockEmbed: params.get('mock_embed') === '1',
  });
}

export function normalizeListeningTest(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('invalid-listening-test');
  const id = requiredText(payload.id, 'invalid-listening-test-id');
  const audioUrl = requiredText(payload.audio_url, 'invalid-listening-audio');
  if (!Array.isArray(payload.sections) || !payload.sections.length) {
    throw new Error('invalid-listening-sections');
  }
  const sections = payload.sections
    .map((section) => ({
      ...section,
      section_num: positiveInteger(section?.section_num, 1),
      exercises: Array.isArray(section?.exercises) ? section.exercises : [],
    }))
    .sort((a, b) => a.section_num - b.section_num);
  return {
    ...payload,
    id,
    test_id: String(payload.test_id || id),
    title: String(payload.title || payload.test_id || 'Listening Test'),
    test_type: String(payload.test_type || 'full'),
    audio_url: audioUrl,
    audio_duration_seconds: Math.max(0, Number(payload.audio_duration_seconds) || 0),
    cue_points: Array.isArray(payload.cue_points) ? payload.cue_points : [],
    sections,
  };
}

export function normalizeListeningResume(payload) {
  const attempt = payload?.attempt;
  if (!attempt) return null;
  const rendererAffinity = attempt.renderer_affinity ?? null;
  if (rendererAffinity !== null && !['legacy', 'next'].includes(rendererAffinity)) {
    throw new Error('invalid-listening-renderer-affinity');
  }
  return {
    attempt_id: requiredText(attempt.attempt_id, 'invalid-listening-attempt'),
    started_at: requiredText(attempt.started_at, 'invalid-listening-start-time'),
    answers: Array.isArray(attempt.answers) ? attempt.answers : [],
    renderer_affinity: rendererAffinity,
  };
}

export function listeningRendererHref(renderer, search) {
  const source = new URLSearchParams(search || '');
  const query = {};
  for (const key of ['id', 'sitting_id', 'mock_embed', 'from', 'class_item']) {
    const value = source.get(key);
    if (value) query[key] = value;
  }
  return corePlayerUrl('listening_test', renderer, query);
}

export function listeningAnswersFromRows(rows) {
  const answers = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const qNum = Number(row?.q_num);
    if (!Number.isInteger(qNum) || qNum < 1 || qNum > 40) continue;
    const value = String(row?.user_answer ?? '');
    if (value) answers.set(qNum, value);
  }
  return answers;
}

export function listeningQuestions(test) {
  const rows = [];
  for (const section of test?.sections || []) {
    for (const exercise of section?.exercises || []) {
      const payload = exercise?.payload || {};
      const questions = Array.isArray(payload.questions)
        ? payload.questions
        : (Array.isArray(payload.items) ? payload.items : []);
      for (const question of questions) {
        const qNum = Number(question?.q_num);
        if (Number.isInteger(qNum) && qNum >= 1 && qNum <= 40) {
          rows.push({ sectionNum: Number(section.section_num), exercise, question: { ...question, q_num: qNum } });
        }
      }
    }
  }
  return rows.sort((a, b) => a.question.q_num - b.question.q_num);
}

export function isPracticeListeningTest(test) {
  return ['mini', 'drill', 'practice'].includes(String(test?.test_type || 'full'));
}

export function listeningResumeOffsetSeconds(startedAt, now = Date.now()) {
  const started = Date.parse(String(startedAt || ''));
  if (!Number.isFinite(started)) throw new Error('invalid-listening-start-time');
  return Math.max(0, Math.floor((now - started) / 1000));
}

/** @param {string | null | undefined} from @param {string | null | undefined} [sittingId] */
export function listeningLibraryHref(from, sittingId = null) {
  if (from === 'mini') return '/listening/mini-test';
  if (from === 'drill') return '/listening/skills';
  if (from === 'practice') return '/listening/practice';
  if (from === 'mock' && sittingId) return `/mock/result?sitting=${encodeURIComponent(String(sittingId))}`;
  return '/listening/tests';
}

/** @param {string} attemptId @param {string | null | undefined} [from] */
export function listeningReviewHref(attemptId, from = null) {
  const query = new URLSearchParams({
    attempt_id: requiredText(attemptId, 'missing-listening-attempt'),
    from: LISTENING_ORIGINS.has(String(from || '')) ? String(from) : 'full',
  });
  return `/listening/review?${query.toString()}`;
}

export function listeningDictationHref(testId) {
  return `/core-player/launch?surface=listening_dictation&test_id=${encodeURIComponent(requiredText(testId, 'missing-listening-test'))}`;
}

export function isRetriableListeningSave(error) {
  if (!error) return false;
  const status = Number(error.status);
  return error.status === undefined || error.status === null
    || [408, 425, 429].includes(status) || status >= 500;
}

export function createListeningSaveCoordinator({
  save,
  debounceMs = 500,
  retryDelays = RETRY_DELAYS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  if (typeof save !== 'function') throw new TypeError('save must be a function');
  const values = new Map();
  const generations = new Map();
  const debounceTimers = new Map();
  const retryTimers = new Map();
  const inflight = new Map();
  const statuses = new Map();
  const listeners = new Set();
  let writeChain = Promise.resolve();
  let disposed = false;

  const snapshot = () => new Map(statuses);
  const notify = () => listeners.forEach((listener) => listener(snapshot()));
  const setStatus = (qNum, value) => {
    if (value) statuses.set(qNum, value); else statuses.delete(qNum);
    notify();
  };
  const cancelTimer = (map, qNum) => {
    const handle = map.get(qNum);
    if (handle !== undefined) clearTimer(handle);
    map.delete(qNum);
  };
  const enqueue = (operation) => {
    const run = writeChain.then(operation, operation);
    writeChain = run.then(() => undefined, () => undefined);
    return run;
  };

  async function persist(qNum, generation, attempt = 0, keepalive = false) {
    if (disposed || generations.get(qNum) !== generation) return null;
    cancelTimer(retryTimers, qNum);
    const operation = () => save(qNum, values.get(qNum) || '', { keepalive });
    // A pagehide keepalive is the fail-safe for a regular request the browser
    // may cancel during unload, so it must leave immediately instead of waiting
    // behind that request in the interactive write chain.
    const promise = keepalive ? Promise.resolve().then(operation) : enqueue(operation);
    inflight.set(qNum, promise);
    try {
      const result = await promise;
      if (generations.get(qNum) === generation) setStatus(qNum, null);
      return result;
    } catch (error) {
      if (generations.get(qNum) !== generation) return null;
      if (!keepalive && isRetriableListeningSave(error) && attempt < retryDelays.length) {
        setStatus(qNum, 'retrying');
        return new Promise((resolve) => {
          const handle = setTimer(() => {
            retryTimers.delete(qNum);
            resolve(persist(qNum, generation, attempt + 1, false));
          }, retryDelays[attempt]);
          retryTimers.set(qNum, handle);
        });
      }
      setStatus(qNum, 'failed');
      return null;
    } finally {
      if (inflight.get(qNum) === promise) inflight.delete(qNum);
    }
  }

  function update(qNum, value) {
    if (disposed) return;
    const normalizedQ = Number(qNum);
    values.set(normalizedQ, String(value ?? ''));
    const generation = (generations.get(normalizedQ) || 0) + 1;
    generations.set(normalizedQ, generation);
    cancelTimer(debounceTimers, normalizedQ);
    cancelTimer(retryTimers, normalizedQ);
    const handle = setTimer(() => {
      debounceTimers.delete(normalizedQ);
      void persist(normalizedQ, generation);
    }, debounceMs);
    debounceTimers.set(normalizedQ, handle);
  }

  async function flush({ keepalive = false } = {}) {
    const due = new Set([
      ...debounceTimers.keys(),
      ...retryTimers.keys(),
      ...inflight.keys(),
      ...statuses.keys(),
    ]);
    for (const qNum of due) {
      cancelTimer(debounceTimers, qNum);
      cancelTimer(retryTimers, qNum);
    }
    const writes = [...due].map((qNum) => {
      const active = inflight.get(qNum);
      // On pagehide an ordinary fetch may be cancelled by the browser. Re-issue
      // that value with keepalive deliberately instead of trusting `active`;
      // PATCH is idempotent per q_num and answer persistence wins over duplicate
      // transport. Interactive flushes still reuse the in-flight request.
      if (active && !keepalive) return active;
      const generation = generations.get(qNum) || 1;
      generations.set(qNum, generation);
      return persist(qNum, generation, 0, keepalive);
    });
    if (!keepalive) await Promise.all(writes);
    return keepalive ? true : statuses.size === 0;
  }

  function retryFailed() {
    for (const [qNum, state] of statuses) {
      if (state !== 'failed') continue;
      const generation = generations.get(qNum) || 1;
      generations.set(qNum, generation);
      void persist(qNum, generation);
    }
  }

  function seed(seedValues) {
    values.clear();
    for (const [qNum, value] of seedValues || []) values.set(Number(qNum), String(value ?? ''));
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function dispose() {
    disposed = true;
    for (const handle of debounceTimers.values()) clearTimer(handle);
    for (const handle of retryTimers.values()) clearTimer(handle);
    debounceTimers.clear();
    retryTimers.clear();
    listeners.clear();
  }

  return { update, flush, retryFailed, seed, subscribe, snapshot, dispose };
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function requiredText(value, code) {
  const text = String(value || '').trim();
  if (!text) throw new Error(code);
  return text;
}
