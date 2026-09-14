const record = (value) => (
  value && typeof value === 'object' && !Array.isArray(value) ? value : null
);
const text = (value) => typeof value === 'string' ? value : null;
const nullableText = (value) => value == null ? null : text(value);
const finite = (value) => typeof value === 'number' && Number.isFinite(value) ? value : null;
const integer = (value) => Number.isInteger(value) ? value : null;

function normalizeRetention(value) {
  const source = record(value);
  if (!source
      || typeof source.is_audio_purged !== 'boolean'
      || typeof source.is_content_purged !== 'boolean'
      || typeof source.is_hidden !== 'boolean') return null;
  const audioDays = source.days_until_audio_purge == null
    ? null : integer(source.days_until_audio_purge);
  const contentDays = source.days_until_content_purge == null
    ? null : integer(source.days_until_content_purge);
  if ((source.days_until_audio_purge != null && audioDays == null)
      || (source.days_until_content_purge != null && contentDays == null)) return null;
  return {
    ...source,
    days_until_audio_purge: audioDays,
    days_until_content_purge: contentDays,
    is_audio_purged: source.is_audio_purged,
    is_content_purged: source.is_content_purged,
    is_hidden: source.is_hidden,
  };
}

export function normalizeSessionRow(value) {
  const source = record(value);
  if (!source) return null;
  const id = text(source.id);
  const mode = text(source.mode);
  const part = integer(source.part);
  const topic = text(source.topic);
  const status = text(source.status);
  const startedAt = text(source.started_at);
  const retention = normalizeRetention(source.retention);
  if (!id || !mode || part == null || !topic || !status || !startedAt || !retention) return null;
  for (const key of ['overall_band', 'band_fc', 'band_lr', 'band_gra', 'band_p']) {
    if (source[key] != null && finite(source[key]) == null) return null;
  }
  return {
    ...source,
    id, mode, part, topic, status,
    started_at: startedAt,
    retention,
  };
}

export function normalizeSessionHistory(value) {
  if (Array.isArray(value)) {
    const sessions = value.map(normalizeSessionRow);
    return sessions.every(Boolean) ? sessions : null;
  }
  const source = record(value);
  if (!source || !Array.isArray(source.sessions)) return null;
  const sessions = source.sessions.map(normalizeSessionRow);
  const total = integer(source.total);
  const page = integer(source.page);
  const pageSize = integer(source.page_size);
  const totalPages = integer(source.total_pages);
  if (!sessions.every(Boolean) || total == null || page == null
      || pageSize == null || totalPages == null) return null;
  return { ...source, sessions, total, page, page_size: pageSize, total_pages: totalPages };
}

function normalizeQuestion(value) {
  const source = record(value);
  if (!source || !text(source.id) || text(source.question_text) == null) return null;
  return { ...source, id: source.id, question_text: source.question_text };
}

function normalizeResponse(value) {
  const source = record(value);
  if (!source || !text(source.id) || !text(source.question_id)
      || typeof source.audio_available !== 'boolean'
      || typeof source.audio_lookup_failed !== 'boolean') return null;
  return { ...source };
}

function normalizeReceipt(value) {
  const source = record(value);
  if (!source || !text(source.id) || !text(source.question_id)
      || (source.persisted_at != null && nullableText(source.persisted_at) == null)) return null;
  return { ...source };
}

function normalizeClassTask(value) {
  if (value == null) return null;
  const source = record(value);
  if (!source || !text(source.item_id) || typeof source.accepting !== 'boolean') return undefined;
  for (const key of ['title', 'due_at', 'submitted_at']) {
    if (source[key] != null && nullableText(source[key]) == null) return undefined;
  }
  return { ...source };
}

export function normalizeSessionDetail(value) {
  const row = normalizeSessionRow(value);
  const source = record(value);
  if (!row || !source || !text(source.session_id)
      || !Array.isArray(source.questions) || !Array.isArray(source.responses)
      || !Array.isArray(source.response_receipts)
      || typeof source.question_lookup_failed !== 'boolean'
      || typeof source.response_lookup_failed !== 'boolean'
      || typeof source.results_sealed !== 'boolean') return null;
  const questions = source.questions.map(normalizeQuestion);
  const responses = source.responses.map(normalizeResponse);
  const receipts = source.response_receipts.map(normalizeReceipt);
  const classTask = normalizeClassTask(source.class_task);
  if (!questions.every(Boolean) || !responses.every(Boolean) || !receipts.every(Boolean)
      || classTask === undefined) return null;
  return {
    ...row,
    session_id: source.session_id,
    questions,
    responses,
    response_receipts: receipts,
    question_lookup_failed: source.question_lookup_failed,
    response_lookup_failed: source.response_lookup_failed,
    results_sealed: source.results_sealed,
    ...(classTask ? { class_task: classTask } : {}),
  };
}

export function normalizeSessionAudioUrls(value) {
  if (!Array.isArray(value)) return null;
  const rows = value.map((item) => {
    const source = record(item);
    if (!source || !text(source.response_id) || !text(source.question_id)
        || !text(source.url) || integer(source.expires_in) == null) return null;
    return { ...source };
  });
  return rows.every(Boolean) ? rows : null;
}
