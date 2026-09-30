const field = (raw, name) => typeof raw?.getAll === 'function'
  ? (raw.getAll(name).length === 1 ? raw.get(name) : undefined) : raw?.[name];

export function readingVocabContext(raw = {}) {
  const difficulty = field(raw, 'difficulty');
  const requestedTag = field(raw, 'tag');
  const tag = typeof requestedTag === 'string' && requestedTag.length <= 80 && !/[\u0000-\u001f\u007f]/.test(requestedTag)
    ? requestedTag.trim() : '';
  const requestedBatches = String(field(raw, 'batches') ?? '1');
  return {
    difficulty: ['foundation', 'intermediate', 'advanced'].includes(difficulty) ? difficulty : '',
    tag,
    batches: /^[1-9]\d{0,2}$/.test(requestedBatches) ? Number(requestedBatches) : 1,
  };
}

export function readingVocabSearch(raw = {}) {
  const context = readingVocabContext(raw);
  const query = new URLSearchParams();
  if (context.difficulty) query.set('difficulty', context.difficulty);
  if (context.tag) query.set('tag', context.tag);
  if (context.batches > 1) query.set('batches', String(context.batches));
  return query.toString();
}

export function readingVocabHref(raw = {}) {
  const query = readingVocabSearch(raw);
  return `/reading/vocab${query ? `?${query}` : ''}`;
}

export function readingVocabArticleHref(slug, raw = {}) {
  const query = new URLSearchParams(readingVocabSearch(raw));
  query.set('from', 'vocab');
  return `/reading/vocab/${encodeURIComponent(slug)}?${query}`;
}

export function readingVocabReturnHref(raw = {}) {
  return field(raw, 'from') === 'vocab' ? readingVocabHref(raw) : '/reading/vocab';
}
