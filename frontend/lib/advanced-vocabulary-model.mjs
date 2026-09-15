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
