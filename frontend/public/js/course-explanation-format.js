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

function listBlock(lines, ordered) {
  const tag = ordered ? 'ol' : 'ul';
  const marker = ordered ? /^\s*\d+[.)]\s+(.+)$/ : /^\s*[-*•]\s+(.+)$/;
  return `<${tag} class="course-explain__list">`
    + lines.map((line) => `<li>${inline(line.match(marker)[1])}</li>`).join('')
    + `</${tag}>`;
}

function authoredBlock(block) {
  const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length && lines.every((line) => /^\s*[-*•]\s+/.test(line))) {
    return listBlock(lines, false);
  }
  if (lines.length && lines.every((line) => /^\s*\d+[.)]\s+/.test(line))) {
    return listBlock(lines, true);
  }
  return `<p class="course-explain__paragraph">${inline(lines.join(' '))}</p>`;
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

export function formatCourseExplanation(value) {
  const text = String(value == null ? '' : value).replace(/\r\n?/g, '\n').trim();
  if (!text) return '';

  const blocks = text.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
  const hasAuthoredList = blocks.some((block) => {
    const lines = block.split('\n').filter((line) => line.trim());
    return lines.length > 0 && (lines.every((line) => /^\s*[-*•]\s+/.test(line))
      || lines.every((line) => /^\s*\d+[.)]\s+/.test(line)));
  });

  if (blocks.length === 1 && !hasAuthoredList && text.length >= 240) {
    const sentences = legacySentences(text.replace(/\s*\n\s*/g, ' '));
    if (sentences.length >= 3) {
      return `<p class="course-explain__lead">${inline(sentences[0])}</p>`
        + `<ul class="course-explain__list course-explain__list--legacy">`
        + sentences.slice(1).map((sentence) => `<li>${inline(sentence)}</li>`).join('')
        + '</ul>';
    }
  }

  return blocks.map(authoredBlock).join('');
}
