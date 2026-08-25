const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const isString = (value) => typeof value === 'string';
const isNullableString = (value) => value == null || isString(value);
const isInteger = (value) => Number.isInteger(value);
const isCount = (value) => isInteger(value) && value >= 0;

export const CONTENT_SKILLS = ['vocab', 'grammar'];

export function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
}

function normalizeTopic(value, expectedSkill) {
  if (!isObject(value)
    || !isUuid(value.id)
    || !isString(value.slug)
    || !isString(value.title)
    || value.skill_area !== expectedSkill
    || !isNullableString(value.title_vi)
    || !isNullableString(value.description)
    || !isInteger(value.order)
    || typeof value.is_published !== 'boolean') return null;
  return {
    id: value.id,
    slug: value.slug,
    title: value.title,
    skillArea: value.skill_area,
    titleVi: value.title_vi ?? '',
    description: value.description ?? '',
    order: value.order,
    published: value.is_published,
  };
}

function normalizeBank(value, expectedSkill) {
  if (!isObject(value)
    || !isUuid(value.id)
    || !isNullableString(value.topic_id)
    || !isString(value.code)
    || !isNullableString(value.title)
    || value.skill_area !== expectedSkill
    || !isCount(value.words_count)
    || typeof value.is_published !== 'boolean') return null;
  return {
    id: value.id,
    topicId: value.topic_id ?? '',
    code: value.code,
    title: value.title ?? '',
    skillArea: value.skill_area,
    wordsCount: value.words_count,
    published: value.is_published,
  };
}

export function normalizeTopicList(value, expectedSkill) {
  if (!CONTENT_SKILLS.includes(expectedSkill) || !Array.isArray(value)) return null;
  const rows = value.map((row) => normalizeTopic(row, expectedSkill));
  return rows.every(Boolean) ? rows : null;
}

export function normalizeTopicAck(value, expectedSkill, expectedId = '') {
  const topic = normalizeTopic(value, expectedSkill);
  return topic && (!expectedId || topic.id === expectedId) ? topic : null;
}

export function normalizeDeleteAck(value, expectedId) {
  return isObject(value) && value.id === expectedId && value.deleted === true;
}

export function normalizeBankList(value, expectedSkill) {
  if (!CONTENT_SKILLS.includes(expectedSkill) || !Array.isArray(value)) return null;
  const rows = value.map((row) => normalizeBank(row, expectedSkill));
  return rows.every(Boolean) ? rows : null;
}

export function normalizeBankAck(value, expectedSkill, expectedId) {
  const bank = normalizeBank(value, expectedSkill);
  return bank && bank.id === expectedId ? bank : null;
}

export function normalizeTopicBundle(value, expectedSkill, expectedId) {
  if (!isObject(value) || !isObject(value.counts) || !Array.isArray(value.vocab_cards) || !Array.isArray(value.quiz_banks)) return null;
  const topic = normalizeTopic(value.topic, expectedSkill);
  if (!topic || topic.id !== expectedId || !isCount(value.counts.vocab_cards) || !isCount(value.counts.quiz_banks)) return null;
  const cards = value.vocab_cards.map((row) => {
    if (!isObject(row) || !isUuid(row.id) || !isString(row.slug) || !isString(row.headword)
      || !isNullableString(row.category) || !isNullableString(row.level)
      || !isNullableString(row.part_of_speech) || !isNullableString(row.audio_status)
      || !isNullableString(row.updated_at)) return null;
    return { id: row.id, slug: row.slug, headword: row.headword };
  });
  const banks = value.quiz_banks.map((row) => {
    if (isObject(row) && row.topic_id != null && row.topic_id !== expectedId) return null;
    return normalizeBank({ ...row, topic_id: expectedId }, expectedSkill);
  });
  if (!cards.every(Boolean) || !banks.every(Boolean)
    || value.counts.vocab_cards !== cards.length || value.counts.quiz_banks !== banks.length) return null;
  return { topic, cards, banks, counts: { vocabCards: cards.length, quizBanks: banks.length } };
}

export function normalizeBankAnalytics(value) {
  if (!isObject(value) || !isCount(value.session_count) || !Array.isArray(value.items) || !Array.isArray(value.skills)) return null;
  const normalizeRows = (rows, key) => rows.map((row) => {
    if (!isObject(row) || !isString(row[key]) || !isCount(row.total) || !isCount(row.wrong)
      || typeof row.error_rate !== 'number' || !Number.isFinite(row.error_rate)
      || row.error_rate < 0 || row.error_rate > 1 || row.wrong > row.total) return null;
    return { label: row[key], total: row.total, wrong: row.wrong, errorRate: row.error_rate };
  });
  const items = normalizeRows(value.items, 'item_key');
  const skills = normalizeRows(value.skills, 'skill');
  return items.every(Boolean) && skills.every(Boolean) ? { sessionCount: value.session_count, items, skills } : null;
}

export function normalizeImportResult(value, expectedDryRun) {
  if (!isObject(value) || value.dry_run !== expectedDryRun || !Array.isArray(value.questions)
    || !Array.isArray(value.validation_errors) || !isObject(value.summary)
    || !isCount(value.summary.words) || !isCount(value.summary.questions)
    || !isCount(value.summary.errors) || !isCount(value.summary.pools)
    || !(value.committed_bank_id == null || isUuid(value.committed_bank_id))) return null;
  const meta = value.meta == null ? null : value.meta;
  if (meta && (!isObject(meta) || !isString(meta.code) || !isNullableString(meta.title) || !CONTENT_SKILLS.includes(meta.skill_area))) return null;
  const questions = value.questions.map((row) => {
    if (!isObject(row) || !isCount(row.index) || !isString(row.qid) || !isString(row.item_key)
      || !isNullableString(row.type) || !isNullableString(row.skill) || !Array.isArray(row.validation_errors)) return null;
    const rowErrors = row.validation_errors.map((error) => isObject(error) && isString(error.field) && isString(error.message) ? error : null);
    return rowErrors.every(Boolean) ? row : null;
  });
  const errors = value.validation_errors.map((row) => {
    if (!isObject(row) || !isInteger(row.block) || !isString(row.qid) || !isString(row.field) || !isString(row.message)) return null;
    return { block: row.block, qid: row.qid, field: row.field, message: row.message };
  });
  if (!questions.every(Boolean) || value.summary.questions !== questions.length
    || !errors.every(Boolean) || value.summary.errors !== errors.length) return null;
  return {
    dryRun: expectedDryRun,
    meta: meta ? { code: meta.code, title: meta.title ?? '', skillArea: meta.skill_area } : null,
    errors,
    summary: { words: value.summary.words, questions: value.summary.questions, errors: value.summary.errors, pools: value.summary.pools },
    committedBankId: value.committed_bank_id ?? '',
  };
}

export function contentSkillQuery(skill) {
  return CONTENT_SKILLS.includes(skill) ? `skill_area=${encodeURIComponent(skill)}` : null;
}
