// LIBRARY-0061 T015 (FR-051): look-up suggestions of the public Vocabulary shelf.
//
// Pure functions over the directory word list ({headword, ...}), shared by the
// browser combobox and the server-rendered "Kết quả tra" page so both agree.
//
// Order of a suggestion list: headwords that start with the query, then
// headwords with a later word that starts with it ("footprint" → "carbon
// footprint"), then the base form of an inflected query ("mitigated",
// "mitigating" → "mitigate"). Nothing is suggested before the second
// character. When nothing matches, `nearWords` gives at most three headwords
// by edit distance.

export const SUGGEST_MIN_CHARS = 2;
export const SUGGEST_LIMIT = 5;
export const NEAR_LIMIT = 3;

/** @param {unknown} value */
export function normalizeQuery(value) {
  return typeof value === 'string' ? value.trim().toLowerCase().replace(/\s+/g, ' ') : '';
}

/**
 * Candidate base forms of one inflected English word, most likely first.
 * @param {string} word lower-case, one token
 * @returns {string[]}
 */
export function baseForms(word) {
  const out = [];
  const add = (stem) => {
    if (stem.length >= 2 && stem !== word && !out.includes(stem)) out.push(stem);
  };
  const undouble = (stem) => (/([b-df-hj-np-tv-z])\1$/.test(stem) ? stem.slice(0, -1) : null);
  if (word.endsWith('ies')) add(`${word.slice(0, -3)}y`);
  if (word.endsWith('ied')) add(`${word.slice(0, -3)}y`);
  if (word.endsWith('ing')) {
    const stem = word.slice(0, -3);
    add(`${stem}e`);
    add(stem);
    const single = undouble(stem);
    if (single) add(single);
  }
  if (word.endsWith('ed')) {
    add(word.slice(0, -1)); // mitigated → mitigate
    const stem = word.slice(0, -2);
    add(stem); // worked → work
    const single = undouble(stem);
    if (single) add(single); // stopped → stop
  }
  if (word.endsWith('es')) add(word.slice(0, -2));
  if (word.endsWith('s') && !word.endsWith('ss')) add(word.slice(0, -1));
  return out;
}

function inflectedTargets(query) {
  const tokens = query.split(' ');
  const last = tokens.at(-1) || '';
  return baseForms(last).map((base) => [...tokens.slice(0, -1), base].join(' '));
}

function byHeadword(a, b) {
  return a.headword.length - b.headword.length || a.headword.localeCompare(b.headword, 'en');
}

/**
 * Words matching a query, in suggestion order (no limit).
 * @template {{ headword: string }} W
 * @param {string} rawQuery
 * @param {readonly W[]} words
 * @returns {W[]}
 */
export function matchWords(rawQuery, words) {
  const query = normalizeQuery(rawQuery);
  if (query.length < SUGGEST_MIN_CHARS) return [];
  const seen = new Set();
  const take = (list) => {
    const fresh = list.filter((word) => !seen.has(word));
    for (const word of fresh) seen.add(word);
    return fresh.sort(byHeadword);
  };
  const lower = (word) => normalizeQuery(word.headword);
  const starts = take(words.filter((word) => lower(word).startsWith(query)));
  const inner = take(words.filter((word) => lower(word).includes(` ${query}`)));
  const targets = inflectedTargets(query);
  const inflected = [];
  for (const target of targets) {
    inflected.push(...take(words.filter((word) => lower(word) === target)));
  }
  return [...starts, ...inner, ...inflected];
}

/**
 * Up to `limit` look-up suggestions (FR-051: from the second character, 5 rows).
 * @template {{ headword: string }} W
 * @param {string} query
 * @param {readonly W[]} words
 * @param {number} [limit]
 * @returns {W[]}
 */
export function suggestWords(query, words, limit = SUGGEST_LIMIT) {
  return matchWords(query, words).slice(0, limit);
}

/**
 * Levenshtein distance, capped: returns `cap + 1` as soon as the distance is
 * known to exceed `cap`.
 * @param {string} a
 * @param {string} b
 * @param {number} cap
 */
export function editDistance(a, b, cap = Infinity) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      row.push(value);
      if (value < best) best = value;
    }
    if (best > cap) return cap + 1;
    prev = row;
  }
  return prev[b.length];
}

/** Largest distance still offered as "Có thể bạn gõ nhầm": 1 for short words, 2 from 5 letters. */
export function nearCap(query) {
  return query.length >= 5 ? 2 : 1;
}

/**
 * Headwords closest to a query that found nothing (FR-051: at most 3).
 * @template {{ headword: string }} W
 * @param {string} rawQuery
 * @param {readonly W[]} words
 * @param {number} [limit]
 * @returns {W[]}
 */
export function nearWords(rawQuery, words, limit = NEAR_LIMIT) {
  const query = normalizeQuery(rawQuery);
  if (query.length < SUGGEST_MIN_CHARS) return [];
  const cap = nearCap(query);
  return words
    .map((word) => ({ word, distance: editDistance(query, normalizeQuery(word.headword), cap) }))
    .filter((item) => item.distance > 0 && item.distance <= cap)
    .sort((a, b) => a.distance - b.distance || a.word.headword.localeCompare(b.word.headword, 'en'))
    .slice(0, limit)
    .map((item) => item.word);
}

/**
 * Address of one entry, also its canonical URL (FR-050).
 * @param {{ category: string, slug: string }} word
 */
export function entryHref(word) {
  return `/vocabulary?cat=${encodeURIComponent(word.category)}&slug=${encodeURIComponent(word.slug)}`;
}
