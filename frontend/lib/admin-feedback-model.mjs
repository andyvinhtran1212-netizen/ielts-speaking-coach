import { readingPreviewHref } from './admin-reading-preview-model.mjs';

const TYPES = new Set(['rating', 'report', 'flag']);
const SKILLS = new Set(['reading', 'listening', 'vocabulary']);
const STATUSES = new Set(['new', 'resolved']);

const record = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : null;
const text = (value) => typeof value === 'string' && value.trim() ? value.trim() : null;
const positiveInteger = (value) => Number.isInteger(value) && value >= 1 ? value : null;
const rating = (value) => Number.isInteger(value) && value >= 1 && value <= 5 ? value : null;

export function normalizeFeedbackFilters(input = {}) {
  return {
    type: TYPES.has(input.type) ? input.type : '',
    skill: SKILLS.has(input.skill) ? input.skill : '',
    status: input.status === 'all' || input.status === '' ? '' : STATUSES.has(input.status) ? input.status : 'new',
  };
}

export function normalizeFeedbackInbox(raw) {
  const source = record(raw);
  if (!source || !['complete', 'partial', 'unavailable'].includes(source.data_status)) return null;
  const status = source.data_status;
  const snapshotTo = text(source.snapshot_to);
  const count = Number.isInteger(source.count) && source.count >= 0 ? source.count : null;
  if (!snapshotTo || !Number.isFinite(Date.parse(snapshotTo)) || (status === 'unavailable' ? count !== null : count === null)) return null;
  if (!Array.isArray(source.items) || !Array.isArray(source.groups)) return null;
  if (
    (source.skill != null && !SKILLS.has(source.skill))
    || (source.feedback_type != null && !TYPES.has(source.feedback_type))
    || (source.status != null && !STATUSES.has(source.status))
  ) return null;
  const truncated = source.truncated === true;
  if ((status === 'partial') !== truncated || (status === 'unavailable' && source.items.length)) return null;
  const items = [];
  let malformedCount = Number.isInteger(source.malformed_count) && source.malformed_count >= 0
    ? source.malformed_count : 0;
  for (const candidate of source.items) {
    const row = record(candidate);
    const id = text(row?.id);
    if (!row || !id || !TYPES.has(row.type) || !SKILLS.has(row.skill) || !STATUSES.has(row.status)) {
      malformedCount += 1;
      continue;
    }
    const identityKind = ['user', 'anonymous', 'unknown'].includes(row.identity_kind)
      ? row.identity_kind : 'unknown';
    items.push({
      id,
      type: row.type,
      skill: row.skill,
      status: row.status,
      testId: text(row.test_id),
      questionNumber: positiveInteger(row.q_num),
      ratingTest: rating(row.rating_de),
      ratingAudio: rating(row.rating_audio),
      category: text(row.category),
      note: text(row.note),
      identityKind,
      createdAt: text(row.created_at),
    });
  }
  if (status !== 'unavailable' && items.length !== count) return null;
  return {
    status,
    snapshotTo,
    skill: SKILLS.has(source.skill) ? source.skill : null,
    type: TYPES.has(source.feedback_type) ? source.feedback_type : null,
    itemStatus: STATUSES.has(source.status) ? source.status : null,
    items,
    count,
    truncated,
    malformedCount,
  };
}

export function groupFeedbackItems(items) {
  const groups = [];
  const index = new Map();
  for (const item of items) {
    const key = `${item.skill}\u0000${item.testId || ''}`;
    let group = index.get(key);
    if (!group) {
      group = { skill: item.skill, testId: item.testId, items: [], newCount: 0 };
      index.set(key, group);
      groups.push(group);
    }
    group.items.push(item);
    if (item.status === 'new') group.newCount += 1;
  }
  return groups;
}

export function averageRating(values) {
  const valid = values.filter((value) => Number.isInteger(value) && value >= 1 && value <= 5);
  if (!valid.length) return null;
  return Math.round(valid.reduce((sum, value) => sum + value, 0) / valid.length * 10) / 10;
}

export function feedbackDeepLink(item) {
  if (item.skill === 'vocabulary' && item.testId) {
    const match = /^vocabulary:([^/]+)\/(.+)$/.exec(item.testId);
    return match ? `/vocabulary?cat=${encodeURIComponent(match[1])}&slug=${encodeURIComponent(match[2])}` : null;
  }
  if (!item.testId || /^(practice|exercise):/.test(item.testId)) return null;
  if (item.skill === 'reading') {
    return readingPreviewHref(item.testId, item.questionNumber);
  }
  // Listening feedback stores the human-facing test_id, while the detail page
  // requires the row UUID. The list is the nearest truthful destination until
  // that surface supports a test_id search param; do not invent a dead query.
  return item.skill === 'listening' ? '/pages/admin/listening/tests.html' : null;
}

export function formatFeedbackTime(value, now = new Date()) {
  const then = Date.parse(value || '');
  if (!Number.isFinite(then)) return 'Không rõ thời gian';
  const seconds = Math.max(0, Math.floor((now.getTime() - then) / 1000));
  if (seconds < 60) return 'Vừa xong';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} phút trước`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} giờ trước`;
  if (seconds < 172800) return 'Hôm qua';
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} ngày trước`;
  return new Date(then).toLocaleDateString('vi-VN', { timeZone: 'UTC' });
}
