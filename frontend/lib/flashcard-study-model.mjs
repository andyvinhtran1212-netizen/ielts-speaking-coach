const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function optionalText(value) {
  return value == null ? '' : text(value);
}

function finite(value, { min = -Infinity, max = Infinity } = {}) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function textList(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) return null;
  const normalized = value.map(text);
  return normalized.some((item) => !item) ? null : normalized;
}

function normalizeReview(value) {
  if (value == null) return null;
  const row = object(value);
  if (!row) return undefined;
  const intervalDays = finite(row.interval_days, { min: 0 });
  const easeFactor = finite(row.ease_factor, { min: 1.3, max: 3 });
  const reviewCount = finite(row.review_count, { min: 0 });
  const lapseCount = finite(row.lapse_count, { min: 0 });
  const nextReviewAt = text(row.next_review_at);
  if (intervalDays == null || !Number.isInteger(intervalDays)
    || easeFactor == null || reviewCount == null || !Number.isInteger(reviewCount)
    || lapseCount == null || !Number.isInteger(lapseCount) || !nextReviewAt) return undefined;
  return {
    intervalDays,
    easeFactor,
    reviewCount,
    lapseCount,
    lastReviewedAt: optionalText(row.last_reviewed_at),
    nextReviewAt,
  };
}

function normalizePersonalCard(value) {
  const row = object(value);
  const id = text(row?.id);
  const headword = text(row?.headword);
  const review = normalizeReview(row?.review);
  if (!UUID_RE.test(id) || !headword || review === undefined) return null;
  return {
    id,
    headword,
    definitionVi: optionalText(row.definition_vi),
    definitionEn: optionalText(row.definition_en),
    ipa: optionalText(row.ipa),
    example: optionalText(row.example_sentence),
    context: optionalText(row.context_sentence),
    topic: optionalText(row.topic),
    sourceType: optionalText(row.source_type),
    audioHeadword: optionalText(row.audio_headword),
    review,
  };
}

function normalizePublicCard(value) {
  const row = object(value);
  const slug = text(row?.slug);
  const headword = text(row?.headword);
  const collocations = textList(row?.collocations);
  const synonyms = textList(row?.synonyms);
  const antonyms = textList(row?.antonyms);
  if (!slug || !headword || collocations == null || synonyms == null || antonyms == null) return null;
  return {
    slug,
    headword,
    pronunciation: optionalText(row.pronunciation),
    definitionVi: optionalText(row.definition_vi) || optionalText(row.gloss_vi),
    definitionEn: optionalText(row.definition_en),
    example: optionalText(row.example),
    partOfSpeech: optionalText(row.part_of_speech),
    level: optionalText(row.level),
    audioHeadword: optionalText(row.audio_headword),
    audioExample: optionalText(row.audio_example),
    collocations,
    synonyms,
    antonyms,
    memoryHook: optionalText(row.memory_hook),
    commonError: optionalText(row.common_error),
  };
}

function normalizeCards(value, normalizeCard, max = 2000) {
  if (!Array.isArray(value) || value.length > max) return null;
  const cards = value.map(normalizeCard);
  if (cards.some((card) => !card)) return null;
  const keys = cards.map((card) => card.id || card.slug);
  if (new Set(keys).size !== keys.length) return null;
  return cards;
}

export function parseFlashcardStack(value) {
  const stack = text(value);
  if (!stack) return null;
  if (stack.startsWith('wiki:')) {
    const key = stack.slice(5).trim();
    return key ? { raw: stack, mode: 'wiki', key, storageKey: `vocabflash:wiki:${key}` } : null;
  }
  if (stack.startsWith('examlist:')) {
    const key = stack.slice(9).trim();
    return key ? { raw: stack, mode: 'exam', key, storageKey: `vocabflash:wiki:exam:${key}` } : null;
  }
  if (stack.startsWith('auto:') || UUID_RE.test(stack)) {
    return { raw: stack, mode: 'personal', key: stack, storageKey: '' };
  }
  return null;
}

export function normalizePersonalStack(value, expectedStack) {
  const row = object(value);
  const cards = normalizeCards(row?.cards, normalizePersonalCard, 1000);
  if (!row || text(row.stack_id) !== expectedStack || !cards) return null;
  return { title: 'Học flashcard', cards };
}

export function normalizePublicStack(value, stack) {
  const row = object(value);
  const cards = normalizeCards(row?.cards, normalizePublicCard);
  if (!row || !cards) return null;
  if (stack.mode === 'wiki' && text(row.category) !== stack.key) return null;
  if (stack.mode === 'exam' && text(row.list) !== stack.key) return null;
  const title = stack.mode === 'wiki' ? text(row.category) : text(row.title);
  return { title: title || stack.key, cards };
}

export function normalizeReviewReceipt(value, expectedVocabId) {
  const row = object(value);
  const intervalDays = finite(row?.interval_days, { min: 0 });
  const easeFactor = finite(row?.ease_factor, { min: 1.3, max: 3 });
  const reviewCount = finite(row?.review_count, { min: 1 });
  if (!row || text(row.vocab_id) !== expectedVocabId || row.status !== 'success'
    || typeof row.replayed !== 'boolean' || intervalDays == null || !Number.isInteger(intervalDays)
    || easeFactor == null || reviewCount == null || !Number.isInteger(reviewCount)
    || !text(row.next_review_at)) return null;
  return {
    replayed: row.replayed,
    intervalDays,
    easeFactor,
    reviewCount,
    nextReviewAt: text(row.next_review_at),
  };
}

export function nextIntervalLabel(card, rating) {
  const ease = card.review?.easeFactor ?? 2.5;
  const interval = card.review?.intervalDays ?? 1;
  const days = rating === 'again' ? 0
    : rating === 'hard' ? Math.max(1, Math.floor(interval * 1.2))
      : rating === 'good' ? Math.max(1, Math.floor(interval * ease))
        : Math.max(1, Math.floor(interval * ease * 1.3));
  if (days === 0) return 'Hôm nay';
  return days < 30 ? `${days} ngày` : `${Math.round(days / 30)} tháng`;
}
