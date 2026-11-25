// Delta log highlighting for the Library sample page (LIBRARY-0061 T010, FR-014).
//
// A delta entry is `{criterion, before, after, why}`: `before` is a phrase of
// the higher-band essay, `after` the matching phrase of the lower-band essay,
// `why` the Vietnamese reason. The page marks each phrase where it sits:
//
// - exact-string match only, after normalising BOTH sides the same way the
//   importer checks them (`normalise_text` in
//   backend/scripts/import_writing_samples.py: NFC, one quote style, runs of
//   whitespace as one space); the mark is placed on the ORIGINAL text through
//   an index map, so the essay is shown byte for byte;
// - a phrase found twice in a paragraph is marked at its first occurrence;
// - no match on either side → the note is shown in the margin only;
// - an entry with no `before` (an error that only the lower band has) marks
//   the lower (right) column only;
// - two marks never overlap: a later phrase that overlaps an earlier mark on
//   the same side is left unmarked on that side.
//
// Pure functions, no DOM: the page renders the segments.

/**
 * @typedef {{ criterion?: string | null, before?: string | null, after?: string | null, why?: string | null }} DeltaEntry
 * @typedef {{ text: string, n?: number, criterion?: string | null }} Segment
 * @typedef {{
 *   n: number,
 *   criterion: string | null,
 *   why: string | null,
 *   before: string | null,
 *   after: string | null,
 *   inHigh: boolean,
 *   inLow: boolean,
 * }} RowNote
 * @typedef {{
 *   index: number,
 *   high: Segment[] | null,
 *   low: Segment[] | null,
 *   same: boolean,
 *   notes: RowNote[],
 * }} ComparisonRow
 * @typedef {{ criterion: string | null, why: string | null, before: string | null, after: string | null }} MarginNote
 */

const QUOTES = new Map([
  ['‘', "'"], ['’', "'"], ['‚', "'"], ['′', "'"],
  ['“', '"'], ['”', '"'], ['„', '"'], ['″', '"'],
]);

// A base character and the combining marks after it: normalised as one unit so
// NFC composition never splits across the index map.
const CLUSTER_RE = /\P{M}\p{M}*|\p{M}+/gsu;

/**
 * Normalises `text` and returns, for every character of the result, the index
 * range `[start, end)` of the original text it came from.
 *
 * @param {string} text
 * @returns {{ norm: string, starts: number[], ends: number[] }}
 */
export function normaliseWithMap(text) {
  const source = typeof text === 'string' ? text : '';
  let norm = '';
  /** @type {number[]} */ const starts = [];
  /** @type {number[]} */ const ends = [];
  let inSpace = false;
  for (const match of source.matchAll(CLUSTER_RE)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (/^\s+$/u.test(match[0])) {
      if (inSpace) {
        ends[ends.length - 1] = end;
      } else {
        norm += ' ';
        starts.push(start);
        ends.push(end);
        inSpace = true;
      }
      continue;
    }
    inSpace = false;
    const unit = match[0].normalize('NFC');
    for (const ch of unit) {
      const out = QUOTES.get(ch) ?? ch;
      for (let i = 0; i < out.length; i += 1) {
        norm += out[i];
        starts.push(start);
        ends.push(end);
      }
    }
  }
  return { norm, starts, ends };
}

/**
 * The normalised form of a phrase, as `normalise_text` produces it (trimmed).
 * @param {string | null | undefined} text
 */
export function normaliseText(text) {
  return normaliseWithMap(text ?? '').norm.trim();
}

/**
 * First occurrence of `needle` in `haystack`, compared normalised, as an index
 * range of the original `haystack`; null when absent or the needle is empty.
 *
 * @param {string} haystack
 * @param {string | null | undefined} needle
 * @returns {{ start: number, end: number } | null}
 */
export function locate(haystack, needle) {
  const wanted = normaliseText(needle);
  if (!wanted) return null;
  const { norm, starts, ends } = normaliseWithMap(haystack);
  const at = norm.indexOf(wanted);
  if (at < 0) return null;
  return { start: starts[at], end: ends[at + wanted.length - 1] };
}

/**
 * Splits an essay into paragraphs: blank lines first; an essay written with
 * single line breaks only is split on those. Empty paragraphs are dropped.
 *
 * @param {string | null | undefined} text
 * @returns {string[]}
 */
export function splitParagraphs(text) {
  const source = typeof text === 'string' ? text.trim() : '';
  if (!source) return [];
  const byBlank = source.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (byBlank.length > 1) return byBlank;
  return source.split(/\n/).map((p) => p.trim()).filter(Boolean);
}

/**
 * Cuts `text` into plain and marked segments. Marks are `{start, end, n,
 * criterion}` with no overlap; they are applied in position order.
 *
 * @param {string} text
 * @param {Array<{ start: number, end: number, n: number, criterion: string | null }>} marks
 * @returns {Segment[]}
 */
export function segmentText(text, marks) {
  const sorted = [...marks].sort((a, b) => a.start - b.start);
  /** @type {Segment[]} */ const out = [];
  let at = 0;
  for (const mark of sorted) {
    if (mark.start > at) out.push({ text: text.slice(at, mark.start) });
    out.push({ text: text.slice(mark.start, mark.end), n: mark.n, criterion: mark.criterion });
    at = mark.end;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

/** @param {{start:number,end:number}[]} taken @param {{start:number,end:number}} span */
function overlaps(taken, span) {
  return taken.some((t) => span.start < t.end && t.start < span.end);
}

/** @param {unknown} value */
function textOrNull(value) {
  return typeof value === 'string' && value.trim() ? value : null;
}

/**
 * Builds the side-by-side comparison of two essays of one pair (7.5 → 7.0 or
 * 7.0 → 6.0). Paragraphs are paired by position. Each delta entry is placed in
 * the first paragraph row where its `before` matches the higher essay or its
 * `after` matches the lower essay; notes of a row are numbered from 1 in the
 * order their mark appears (higher column first, else lower column).
 *
 * @param {string | null | undefined} highText
 * @param {string | null | undefined} lowText
 * @param {readonly DeltaEntry[] | null | undefined} deltas
 * @returns {{ rows: ComparisonRow[], marginOnly: MarginNote[] }}
 */
export function buildComparison(highText, lowText, deltas) {
  const highParas = splitParagraphs(highText);
  const lowParas = splitParagraphs(lowText);
  const count = Math.max(highParas.length, lowParas.length);
  /** @type {Array<Array<{ entry: DeltaEntry, hi: {start:number,end:number}|null, lo: {start:number,end:number}|null }>>} */
  const placed = Array.from({ length: count }, () => []);
  /** @type {Array<{start:number,end:number}[]>} */ const takenHi = Array.from({ length: count }, () => []);
  /** @type {Array<{start:number,end:number}[]>} */ const takenLo = Array.from({ length: count }, () => []);
  /** @type {MarginNote[]} */ const marginOnly = [];

  for (const entry of Array.isArray(deltas) ? deltas : []) {
    if (!entry || typeof entry !== 'object') continue;
    const before = textOrNull(entry.before);
    const after = textOrNull(entry.after);
    let done = false;
    for (let r = 0; r < count && !done; r += 1) {
      let hi = before && highParas[r] ? locate(highParas[r], before) : null;
      let lo = after && lowParas[r] ? locate(lowParas[r], after) : null;
      if (hi && overlaps(takenHi[r], hi)) hi = null;
      if (lo && overlaps(takenLo[r], lo)) lo = null;
      if (!hi && !lo) continue;
      if (hi) takenHi[r].push(hi);
      if (lo) takenLo[r].push(lo);
      placed[r].push({ entry, hi, lo });
      done = true;
    }
    if (!done) {
      marginOnly.push({
        criterion: textOrNull(entry.criterion),
        why: textOrNull(entry.why),
        before,
        after,
      });
    }
  }

  /** @type {ComparisonRow[]} */
  const rows = [];
  for (let r = 0; r < count; r += 1) {
    const ordered = [...placed[r]].sort((a, b) => {
      const ka = a.hi ? [0, a.hi.start] : [1, a.lo?.start ?? 0];
      const kb = b.hi ? [0, b.hi.start] : [1, b.lo?.start ?? 0];
      return ka[0] - kb[0] || ka[1] - kb[1];
    });
    const notes = ordered.map((p, i) => ({
      n: i + 1,
      criterion: textOrNull(p.entry.criterion),
      why: textOrNull(p.entry.why),
      before: textOrNull(p.entry.before),
      after: textOrNull(p.entry.after),
      inHigh: Boolean(p.hi),
      inLow: Boolean(p.lo),
    }));
    const hiMarks = ordered.flatMap((p, i) => (p.hi ? [{ ...p.hi, n: i + 1, criterion: notes[i].criterion }] : []));
    const loMarks = ordered.flatMap((p, i) => (p.lo ? [{ ...p.lo, n: i + 1, criterion: notes[i].criterion }] : []));
    const high = highParas[r] ?? null;
    const low = lowParas[r] ?? null;
    rows.push({
      index: r,
      high: high === null ? null : segmentText(high, hiMarks),
      low: low === null ? null : segmentText(low, loMarks),
      same: high !== null && low !== null && notes.length === 0 && normaliseText(high) === normaliseText(low),
      notes,
    });
  }
  return { rows, marginOnly };
}

/**
 * Underline style of a criterion in the lower column (tờ BaiMauWriting legend):
 * Task Response / Task Achievement dotted, Coherence and Cohesion dashed,
 * Lexical Resource wavy, Grammatical Range and Accuracy solid.
 *
 * @param {string | null | undefined} criterion full English name
 * @returns {'tr' | 'cc' | 'lr' | 'gra' | null}
 */
export function criterionStyle(criterion) {
  switch (criterion) {
    case 'Task Response':
    case 'Task Achievement':
      return 'tr';
    case 'Coherence and Cohesion':
      return 'cc';
    case 'Lexical Resource':
      return 'lr';
    case 'Grammatical Range and Accuracy':
      return 'gra';
    default:
      return null;
  }
}
