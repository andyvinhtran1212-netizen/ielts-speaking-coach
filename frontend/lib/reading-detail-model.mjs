const LIBRARIES = new Set(['vocab', 'skill']);
const FORBIDDEN_QUESTION_KEYS = new Set(['answer', 'answers', 'expected', 'explanation', 'solution']);

function objectOf(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function nullableText(value) {
  const text = textOf(value);
  return text || null;
}

function positiveInteger(value) {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

export function safeImageUrl(value) {
  const text = textOf(value);
  if (!text) return null;
  try {
    const url = new URL(text, 'https://www.averlearning.com');
    if (!['https:', 'http:'].includes(url.protocol)) return null;
    return text.startsWith('/') ? `${url.pathname}${url.search}${url.hash}` : url.href;
  } catch {
    return null;
  }
}

function containsAnswerKey(value, depth = 0) {
  if (depth > 5) return true;
  if (Array.isArray(value)) return value.some((item) => containsAnswerKey(item, depth + 1));
  const object = objectOf(value);
  if (!object) return false;
  return Object.entries(object).some(([key, item]) => (
    FORBIDDEN_QUESTION_KEYS.has(key.toLowerCase()) || containsAnswerKey(item, depth + 1)
  ));
}

function normalizeOptions(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (typeof raw === 'string') {
      const text = textOf(raw);
      return text ? [{ label: text, text }] : [];
    }
    const option = objectOf(raw);
    if (!option) return [];
    const label = textOf(option.label);
    const text = textOf(option.text);
    if (!label && !text) return [];
    return [{ label: label || text, text: text || label }];
  });
}

function normalizeQuestion(value) {
  const raw = objectOf(value);
  if (!raw || containsAnswerKey(raw)) return null;
  const qNum = positiveInteger(raw.q_num);
  const type = textOf(raw.question_type);
  const prompt = textOf(raw.prompt);
  const payload = objectOf(raw.payload) || {};
  if (!qNum || !type || !prompt) return null;
  return {
    qNum,
    type,
    prompt,
    options: normalizeOptions(payload.options),
    skillTag: nullableText(raw.skill_tag),
    subSkill: nullableText(raw.sub_skill),
  };
}

function normalizeGlossary(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    const item = objectOf(raw);
    if (!item) return [];
    const term = textOf(item.term);
    const definition = textOf(item.definition);
    if (!term || !definition) return [];
    const synonyms = Array.isArray(item.synonyms)
      ? item.synonyms.map(textOf).filter(Boolean)
      : textOf(item.synonyms);
    return [{
      term,
      definition,
      ipa: nullableText(item.ipa),
      pos: nullableText(item.pos),
      example: nullableText(item.example),
      synonyms,
      aliases: Array.isArray(item.aliases) ? item.aliases.map(textOf).filter(Boolean).slice(0, 20) : [],
    }];
  });
}

function normalizeGrammarFocus(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    const item = objectOf(raw);
    if (!item) return [];
    const point = textOf(item.point);
    if (!point) return [];
    return [{
      point,
      example: nullableText(item.example),
      analysis: nullableText(item.analysis),
      review: nullableText(item.review),
      tip: nullableText(item.tip),
    }];
  });
}

export function validReadingSlug(value) {
  return /^[a-z0-9](?:[a-z0-9-]{0,158}[a-z0-9])?$/.test(textOf(value));
}

export function readingDetailPath(library, slug) {
  if (!LIBRARIES.has(library) || !validReadingSlug(slug)) return null;
  return `/api/reading/${library}/${encodeURIComponent(slug)}`;
}

export function normalizeReadingDetail(payload, expectedSlug) {
  const raw = objectOf(payload);
  if (!raw || !validReadingSlug(expectedSlug)) return null;
  const slug = textOf(raw.slug);
  const title = textOf(raw.title);
  const bodyMarkdown = typeof raw.body_markdown === 'string' ? raw.body_markdown : '';
  if (slug !== expectedSlug || !title || !bodyMarkdown.trim()) return null;
  if (!Array.isArray(raw.questions)) return null;
  const questions = raw.questions.map(normalizeQuestion);
  if (questions.some((question) => !question)) return null;
  const qNums = questions.map((question) => question.qNum);
  if (new Set(qNums).size !== qNums.length) return null;
  return {
    id: nullableText(raw.id),
    slug,
    title,
    bodyMarkdown,
    sourceSha256: /^[a-f0-9]{64}$/.test(raw.source_sha256) ? raw.source_sha256 : null,
    difficulty: nullableText(raw.difficulty_level),
    topics: Array.isArray(raw.topic_tags)
      ? [...new Set(raw.topic_tags.map(textOf).filter(Boolean))].slice(0, 3)
      : [],
    imageUrl: safeImageUrl(raw.image_url),
    glossary: normalizeGlossary(raw.glossary),
    skillFocus: nullableText(raw.skill_focus),
    wordCount: positiveInteger(raw.word_count),
    estimatedMinutes: positiveInteger(raw.estimated_minutes),
    translationVi: typeof raw.translation_vi === 'string' && raw.translation_vi.trim() ? raw.translation_vi : null,
    grammarFocus: normalizeGrammarFocus(raw.grammar_focus),
    practiceSupport: normalizePracticeSupport(raw.practice_support),
    questions,
  };
}

export function normalizeReadingCheck(payload, expectedQNum) {
  const raw = objectOf(payload);
  if (!raw || !Array.isArray(raw.results) || raw.results.length !== 1) return null;
  const result = objectOf(raw.results[0]);
  if (!result || positiveInteger(result.q_num) !== expectedQNum || typeof result.correct !== 'boolean') return null;
  if (typeof result.expected !== 'string') return null;
  if (result.explanation != null && typeof result.explanation !== 'string') return null;
  if (result.skill_tag != null && typeof result.skill_tag !== 'string') return null;
  return {
    qNum: expectedQNum,
    correct: result.correct,
    expected: result.expected.trim(),
    explanation: nullableText(result.explanation),
    skillTag: nullableText(result.skill_tag),
    evidence: normalizePracticeEvidence(result.evidence),
  };
}

function illustrationOf(raw) {
  const item = objectOf(raw);
  return item && /^\/reading-illustrations\/[a-z0-9-]+\.svg$/.test(item.src)
    && textOf(item.alt) && textOf(item.caption)
    ? { src: item.src, alt: item.alt, caption: item.caption } : null;
}

export function normalizePracticeSupport(value) {
  const raw = objectOf(value);
  if (!raw || raw.schema_version !== 1 || !/^[a-f0-9]{64}$/.test(raw.source_sha256)
    || !/^[a-f0-9]{64}$/.test(raw.translation_sha256) || !Array.isArray(raw.units)
    || raw.units.length > 160 || !Array.isArray(raw.illustrations) || raw.illustrations.length > 6) return null;
  const units = raw.units.map((unit) => {
    if (!objectOf(unit) || !/^[a-z0-9-]{1,40}$/.test(unit.id) || !textOf(unit.source)
      || unit.source.length > 4000 || !textOf(unit.translation_vi) || unit.translation_vi.length > 6000
      || !['sentence', 'paragraph'].includes(unit.precision) || !Array.isArray(unit.phrases) || unit.phrases.length > 24) return null;
    const phrases = unit.phrases.map((phrase) => objectOf(phrase) && textOf(phrase.source) && textOf(phrase.target)
      && phrase.source.length <= 300 && phrase.target.length <= 400
      && unit.source.split(phrase.source).length === 2 && unit.translation_vi.split(phrase.target).length === 2
      ? { source: phrase.source, target: phrase.target } : null);
    if (phrases.some((phrase) => !phrase)) return null;
    for (const side of ['source', 'target']) {
      const text = side === 'source' ? unit.source : unit.translation_vi;
      const spans = phrases.map((phrase) => ({ start: text.indexOf(phrase[side]), end: text.indexOf(phrase[side]) + phrase[side].length })).sort((a, b) => a.start - b.start);
      if (spans.some((span, index) => index > 0 && span.start < spans[index - 1].end)) return null;
    }
    return { id: unit.id, source: unit.source, translation_vi: unit.translation_vi, precision: unit.precision, phrases };
  });
  const illustrations = raw.illustrations.map(illustrationOf);
  return units.some((unit) => !unit) || illustrations.some((item) => !item)
    || new Set(units.map((unit) => unit.id)).size !== units.length ? null
    : { schema_version: 1, source_sha256: raw.source_sha256, translation_sha256: raw.translation_sha256, units, illustrations };
}

export function normalizePracticeEvidence(value) {
  const raw = objectOf(value);
  if (!raw || raw.precision !== 'quote' || !textOf(raw.source) || raw.source.length > 4000
    || !/^[a-f0-9]{64}$/.test(raw.source_sha256) || !Array.isArray(raw.illustrations) || raw.illustrations.length > 6) return null;
  const illustrations = raw.illustrations.map(illustrationOf);
  return illustrations.some((item) => !item) ? null : { source: raw.source, precision: 'quote', source_sha256: raw.source_sha256, illustrations };
}

export function answerForQuestion(question, answers) {
  const value = answers[question.qNum];
  return typeof value === 'string' ? value.trim() : '';
}
