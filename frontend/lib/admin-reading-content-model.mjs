const LIBRARIES = new Set(['l1_vocab', 'l2_skill', 'l3_test']);
const STATUSES = new Set(['draft', 'published', 'archived']);

const objectOf = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : null;
const textOf = (value) => typeof value === 'string' ? value.trim() : '';
const nullableText = (value) => textOf(value) || null;

export const READING_LIBRARY_LABEL = Object.freeze({
  l1_vocab: 'L1 Vocab',
  l2_skill: 'L2 Skill',
  l3_test: 'L3 Test',
});

export function normalizeReadingContentItem(raw) {
  const value = objectOf(raw);
  if (!value) return null;
  const id = textOf(value.id);
  const slug = textOf(value.slug);
  const library = textOf(value.library);
  if (!id || !slug || !LIBRARIES.has(library)) return null;
  const status = textOf(value.status);
  if (!STATUSES.has(status)) return null;
  return {
    id,
    slug,
    library,
    title: textOf(value.title) || slug,
    status,
    difficultyLevel: nullableText(value.difficulty_level),
    skillFocus: nullableText(value.skill_focus),
    topicTags: Array.isArray(value.topic_tags) ? value.topic_tags.map(textOf).filter(Boolean) : [],
    examOnly: Boolean(value.exam_only),
    locked: Boolean(value.locked),
    shareActive: Boolean(value.share_active),
    shareExpiresAt: nullableText(value.share_expires_at),
    contentAuditStatus: nullableText(value.content_audit_status),
    contentAuditedAt: nullableText(value.content_audited_at),
    updatedAt: nullableText(value.updated_at),
    createdAt: nullableText(value.created_at),
  };
}

export function normalizeReadingContentList(raw, expected = {}) {
  const value = objectOf(raw);
  if (!value || !Array.isArray(value.items)) return null;
  const limit = Number(value.limit);
  const offset = Number(value.offset);
  const total = Number(value.total);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) return null;
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(total) || total < 0) return null;
  if (expected.limit != null && limit !== expected.limit) return null;
  if (expected.offset != null && offset !== expected.offset) return null;
  const rows = [];
  let malformedCount = 0;
  for (const item of value.items) {
    const row = normalizeReadingContentItem(item);
    if (row) rows.push(row); else malformedCount += 1;
  }
  return { rows, malformedCount, limit, offset, total };
}

export function normalizeReadingImport(raw, expectedDryRun) {
  const value = objectOf(raw);
  if (!value || Boolean(value.dry_run) !== expectedDryRun) return null;
  const validationErrors = Array.isArray(value.validation_errors)
    ? value.validation_errors.map((item) => {
      const row = objectOf(item);
      if (!row) return null;
      const message = textOf(row.message);
      return message ? { field: textOf(row.field) || 'file', message } : null;
    }).filter(Boolean)
    : [];
  const warnings = Array.isArray(value.warnings) ? value.warnings.map(textOf).filter(Boolean) : [];
  const parsed = objectOf(value.parsed_data);
  if (expectedDryRun && !parsed && validationErrors.length === 0) return null;
  return {
    dryRun: expectedDryRun,
    parsed,
    validationErrors,
    warnings,
    bundleSummary: objectOf(value.bundle_summary),
    action: nullableText(value.action),
    committedId: nullableText(value.committed_id),
  };
}

export function readingPreviewRows(parsed, bundleSummary = null) {
  const value = objectOf(parsed) || {};
  const isTest = value.content_type === 'reading_full_test';
  const rows = isTest ? [
    ['Loại nội dung', value.content_type], ['Thư viện', value.library],
    ['Test ID', value.test_id], ['Tiêu đề', value.title], ['Module', value.module],
    ['Thời lượng', value.time_limit_minutes == null ? null : `${value.time_limit_minutes} phút`],
    ['Số passage', value.passage_count], ['Tổng câu hỏi', value.total_questions],
    ['Band mục tiêu', value.band_target], ['Phát hành', value.published ? 'Có' : 'Chưa'],
  ] : [
    ['Loại nội dung', value.content_type], ['Thư viện', value.library],
    ['Tiêu đề', value.title], ['Slug', value.slug], ['Độ khó', value.difficulty_level],
    ['Kỹ năng', value.skill_focus], ['Chủ đề', Array.isArray(value.topic_tags) ? value.topic_tags.join(', ') : null],
    ['Glossary', Array.isArray(value.glossary) ? `${value.glossary.length} mục` : null],
    ['Câu hỏi', value.question_count ?? 0], ['Phát hành', value.published ? 'Có' : 'Chưa'],
  ];
  const summary = objectOf(bundleSummary);
  if (summary) {
    rows.push(['Passage có bản dịch', summary.passages_with_translation]);
    rows.push(['Cụm IMG-PROMPT', summary.img_prompt_blocks]);
    rows.push(['Câu có giải chi tiết', summary.questions_with_solution]);
  }
  return rows.map(([label, raw]) => ({ label, value: raw == null || raw === '' ? '—' : String(raw) }));
}

export function normalizeExamOnlyAck(raw, testId, expected) {
  const value = objectOf(raw);
  return value && textOf(value.test_id) === testId && value.exam_only === expected;
}

export function normalizeLockAck(raw, testId, expected) {
  const value = objectOf(raw);
  if (!value || textOf(value.test_id) !== testId || value.locked !== expected) return null;
  const password = nullableText(value.password);
  if (expected && !password) return null;
  if (!expected && password) return null;
  return { locked: expected, password };
}

export function normalizeShareAck(raw, testId, revoke = false) {
  const value = objectOf(raw);
  if (!value || textOf(value.test_id) !== testId) return null;
  if (revoke) return value.share == null ? { revoked: true } : null;
  const share = objectOf(value.share);
  const token = textOf(share?.token);
  const expiresAt = textOf(share?.expires_at);
  return token && expiresAt ? { token, expiresAt } : null;
}

export function normalizeDeleteAck(raw, item) {
  const value = objectOf(raw);
  if (!value || !item) return null;
  if (item.library === 'l3_test') {
    const action = textOf(value.action);
    if (textOf(value.test_id) !== item.slug || !['deleted', 'archived'].includes(action)) return null;
    return { action, attemptsPreserved: Math.max(0, Number(value.attempts_preserved) || 0) };
  }
  return textOf(value.slug) === item.slug && value.action === 'deleted' ? { action: 'deleted', attemptsPreserved: 0 } : null;
}

export function canonicalReadingShareUrl(token, locationLike) {
  const cleanToken = textOf(token);
  if (!cleanToken || !locationLike) return '';
  let host = textOf(locationLike.hostname).replace(/\.+$/, '');
  if (host === 'averlearning.com') host = 'www.averlearning.com';
  const protocol = textOf(locationLike.protocol) || 'https:';
  const port = textOf(locationLike.port);
  const admissionPath = '/core-player/launch';
  return `${protocol}//${host}${port ? `:${port}` : ''}${admissionPath}?surface=reading_exam&share=${encodeURIComponent(cleanToken)}`;
}

export function formatReadingContentDate(value) {
  const raw = textOf(value);
  if (!raw) return '—';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
