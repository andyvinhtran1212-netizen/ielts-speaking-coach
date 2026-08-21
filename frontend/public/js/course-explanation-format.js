/**
 * Safe, deliberately small formatter for answer explanations.
 *
 * Explanations are authored content, not trusted HTML. Escape first, then
 * support only the structures this product owns: bold labels, paragraphs and
 * explicit ordered/unordered lists. Older banks stored long explanations as a
 * single paragraph; for those only, a bounded fallback turns complete
 * sentences into scan-friendly points. It never splits on commas/semicolons.
 */

export function escapeExplanationText(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inline(text) {
  return escapeExplanationText(text).replace(
    /\*\*([^*]+)\*\*/g,
    '<strong class="course-explain__emphasis">$1</strong>',
  );
}

const UNORDERED = /^\s*[-*•]\s+(.+)$/;
const ORDERED = /^\s*\d+[.)]\s+(.+)$/;

function listBlock(items, ordered, legacy = false) {
  const tag = ordered ? 'ol' : 'ul';
  const classes = 'course-explain__list' + (legacy ? ' course-explain__list--legacy' : '');
  return `<${tag} class="${classes}">`
    + items.map((item) => `<li>${inline(item)}</li>`).join('')
    + `</${tag}>`;
}

function authoredBlocks(block) {
  const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
  const result = [];
  let run = null;

  const flush = () => {
    if (!run) return;
    if (run.kind === 'paragraph') {
      result.push({ kind: 'paragraph', text: run.items.join(' ') });
    } else {
      result.push({ kind: run.kind, items: run.items });
    }
    run = null;
  };

  lines.forEach((line) => {
    const unordered = line.match(UNORDERED);
    const ordered = line.match(ORDERED);
    const kind = unordered ? 'unordered-list' : ordered ? 'ordered-list' : 'paragraph';
    const value = unordered ? unordered[1] : ordered ? ordered[1] : line;
    if (!run || run.kind !== kind) {
      flush();
      run = { kind, items: [] };
    }
    run.items.push(value);
  });
  flush();
  return result;
}

function legacySentences(text) {
  // Safari 15 is supported, so avoid regex lookbehind here. A boundary needs
  // terminal punctuation and a plausible new sentence; prose after a
  // semicolon deliberately stays together.
  return text
    .replace(/([.!?])\s+(?=(?:["“‘']?[A-ZÀ-Ỵ]))/gu, '$1\n')
    .split('\n')
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

export function parseCourseExplanation(value) {
  const text = String(value == null ? '' : value).replace(/\r\n?/g, '\n').trim();
  if (!text) return [];

  const blocks = text.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
  const hasAuthoredList = blocks.some((block) => block.split('\n')
    .some((line) => UNORDERED.test(line) || ORDERED.test(line)));

  if (blocks.length === 1 && !hasAuthoredList && text.length >= 240) {
    const sentences = legacySentences(text.replace(/\s*\n\s*/g, ' '));
    if (sentences.length >= 3) {
      return [
        { kind: 'lead', text: sentences[0] },
        { kind: 'unordered-list', items: sentences.slice(1), legacy: true },
      ];
    }
  }

  return blocks.flatMap(authoredBlocks);
}

export function formatCourseExplanation(value) {
  return parseCourseExplanation(value).map((block) => {
    if (block.kind === 'ordered-list') return listBlock(block.items, true);
    if (block.kind === 'unordered-list') return listBlock(block.items, false, block.legacy);
    const className = block.kind === 'lead'
      ? 'course-explain__lead' : 'course-explain__paragraph';
    return `<p class="${className}">${inline(block.text)}</p>`;
  }).join('');
}
