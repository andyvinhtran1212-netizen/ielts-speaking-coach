// `{{n}}` marks a numbered blank. Some imported templates also keep the printed
// underscore run after it (`{{21}} ________`); that run is the same blank, so it
// is consumed with the marker instead of rendering as a second empty gap (RV-05).
const NUMBERED_BLANK = String.raw`\{\{\s*(\d{1,3})\s*\}\}(?:[ \t]*_{3,})?`;
const DUPLICATED_BLANK = /\{\{\s*(\d{1,3})\s*\}\}[ \t]*_{3,}/g;
const MARKDOWN_IMAGE = /!\[[^\]\n]*\]\([^)\n]*\)/g;

/** A fresh global matcher; group 1 is the question number. */
export function numberedBlankPattern() {
  return new RegExp(NUMBERED_BLANK, 'g');
}

/** Split text into strings and `{ qNum, source }` blank markers. */
export function splitNumberedBlanks(value) {
  const source = String(value ?? '');
  const parts = [];
  let last = 0;
  for (const match of source.matchAll(numberedBlankPattern())) {
    if (match.index > last) parts.push(source.slice(last, match.index));
    parts.push({ qNum: Number(match[1]), source: match[0] });
    last = match.index + match[0].length;
  }
  if (last < source.length) parts.push(source.slice(last));
  return parts;
}

/** Question numbers whose `{{n}}` marker is followed by a redundant underscore run. */
export function duplicatedBlankNumbers(value) {
  return [...String(value ?? '').matchAll(DUPLICATED_BLANK)].map((match) => Number(match[1]));
}

/** True when text carries authoring markup a plain-text row cannot render. */
export function hasDiagramPromptMarkup(value) {
  const source = String(value ?? '');
  return new RegExp(MARKDOWN_IMAGE.source).test(source) || new RegExp(NUMBERED_BLANK).test(source);
}

/** Plain-text diagram row prompt: drop `![…](…)` images, show `{{n}}` as `(n) ______`. */
export function plainDiagramPrompt(value) {
  return String(value ?? '')
    .replace(MARKDOWN_IMAGE, '')
    .replace(numberedBlankPattern(), (_, qNum) => `(${Number(qNum)}) ______`)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
