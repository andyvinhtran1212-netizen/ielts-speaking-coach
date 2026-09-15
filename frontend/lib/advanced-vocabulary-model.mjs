function cleanBandText(value) {
  return String(value || '').trim().replace(/^[→↗-]\s*/, '');
}

function splitTechnique(value) {
  const text = String(value || '').trim();
  const match = text.match(/\s*\(([^()]*)\)\s*$/);
  return {
    text: match ? text.slice(0, match.index).trim() : text,
    technique: match?.[1]?.trim() || '',
  };
}

function normalizeOption(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Keep shared instructions/banks, but remove material already rendered by a
 * structured question control (question line, repeated stem, or MCQ choices). */
export function readingSupportLines(content) {
  const questions = Array.isArray(content?.questions) ? content.questions : [];
  const questionStems = new Set(questions.map((question) => String(question?.stem || '').trim()));
  const mcqOptions = questions
    .filter((question) => /(?:mcq|multiple choice)/i.test(String(question?.question_type || '')))
    .flatMap((question) => Array.isArray(question?.options) ? question.options : [])
    .map((option) => normalizeOption(option?.text ?? option))
    .filter(Boolean);
  const safe = [];
  for (const line of Array.isArray(content?.question_material) ? content.question_material : []) {
    const text = String(line || '').trim();
    if (/^(?:master\s+answer\s+key|answer\s+key|vocabulary\s+profile|quality\s+checks?|supplement\b|editorial\b)/i.test(text)) break;
    if (!text || questionStems.has(text) || /^\d+[.)]\s/.test(text)) continue;
    const normalized = normalizeOption(text);
    const embedded = mcqOptions.filter((option) => normalized.includes(option));
    if (embedded.length >= 2) continue;
    if (/^[A-Z][.)]\s/.test(text) && embedded.length === 1) continue;
    safe.push(line);
  }
  return safe;
}

/**
 * Normalise the authored Speaking variants used across ADV-T01…ADV-T30.
 * Sources use “Example”, “Sentence”, or bare repeated Band 7 → Band 8 rows.
 */
export function buildSpeakingLadders(blocks) {
  const ladders = [];
  let pendingTitle = '';
  let current = null;
  for (const block of Array.isArray(blocks) ? blocks : []) {
    const raw = String(block?.text || '').trim();
    if (block?.type === 'heading') {
      pendingTitle = '';
      current = null;
      continue;
    }
    if (block?.type === 'paragraph' && /^(?:Example|Sentence)\s+\d+/i.test(raw)) {
      pendingTitle = raw.replace(/^Example\s+(\d+)\s*[—-]?\s*/i, 'Ví dụ $1 · ');
      current = null;
      continue;
    }
    const line = cleanBandText(raw);
    const match = line.match(/^Band\s+([678])\s*:\s*(.+)$/i);
    if (!match) continue;
    const band = `Band ${match[1]}`;
    if (!current || current.bands.some((row) => row.band === band)) {
      current = {
        title: pendingTitle || `Nâng cấp câu ${ladders.length + 1}`,
        bands: [],
      };
      ladders.push(current);
      pendingTitle = '';
    }
    current.bands.push({ band, ...splitTechnique(match[2]) });
  }
  return ladders;
}
