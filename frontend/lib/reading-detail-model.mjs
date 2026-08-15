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

function safeImageUrl(value) {
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
    difficulty: nullableText(raw.difficulty_level),
    topics: Array.isArray(raw.topic_tags)
      ? [...new Set(raw.topic_tags.map(textOf).filter(Boolean))].slice(0, 3)
      : [],
    imageUrl: safeImageUrl(raw.image_url),
    glossary: normalizeGlossary(raw.glossary),
    skillFocus: nullableText(raw.skill_focus),
    wordCount: positiveInteger(raw.word_count),
    estimatedMinutes: positiveInteger(raw.estimated_minutes),
    translationVi: nullableText(raw.translation_vi),
    grammarFocus: normalizeGrammarFocus(raw.grammar_focus),
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
  };
}

export function answerForQuestion(question, answers) {
  const value = answers[question.qNum];
  return typeof value === 'string' ? value.trim() : '';
}
