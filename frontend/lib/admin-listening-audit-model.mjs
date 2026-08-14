import { normalizeListeningTestList } from './admin-listening-content-model.mjs';

const TEST_TYPES = new Set(['all', 'full', 'mini', 'drill', 'practice']);
const TEST_STATUSES = new Set(['draft', 'published', 'archived']);
const HEALTH_FILTERS = new Set(['all', 'error', 'warning', 'clean', 'lookup']);
const SAVED_FILTERS = new Set(['all', 'pending', 'passed', 'has_issues', 'fixed']);
const SAVED_STATUSES = new Set(['pending', 'passed', 'has_issues', 'fixed']);
const objectOf = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : null;
const textOf = (value) => typeof value === 'string' ? value.trim() : '';
const nullableText = (value) => textOf(value) || null;
const integer = (value) => typeof value === 'number' && Number.isInteger(value) ? value : null;

export const LISTENING_AUDIT_TYPE_LABEL = Object.freeze({
  all: 'Mọi loại', full: 'Full test', mini: 'Lesson / Mini', drill: 'Skill drill', practice: 'Luyện nhanh',
});
export const LISTENING_AUDIT_HEALTH_LABEL = Object.freeze({
  all: 'Mọi live health', error: 'Có lỗi', warning: 'Có cảnh báo', clean: 'Sạch', lookup: 'Lookup failed',
});
export const LISTENING_AUDIT_SAVED_LABEL = Object.freeze({
  all: 'Mọi full-audit', pending: 'Chưa chạy full audit', passed: 'Đã đạt', has_issues: 'Có lỗi đã lưu', fixed: 'Đã đánh dấu sửa',
});

export function normalizeListeningAuditFilters(input = {}) {
  return {
    search: textOf(input.search).slice(0, 80),
    type: TEST_TYPES.has(input.type) ? input.type : 'all',
    health: HEALTH_FILTERS.has(input.health) ? input.health : 'all',
    saved: SAVED_FILTERS.has(input.saved) ? input.saved : 'all',
  };
}

export function listeningAuditHref(input = {}) {
  const value = normalizeListeningAuditFilters(input);
  const query = new URLSearchParams();
  if (value.search) query.set('search', value.search);
  if (value.type !== 'all') query.set('type', value.type);
  if (value.health !== 'all') query.set('health', value.health);
  if (value.saved !== 'all') query.set('saved', value.saved);
  return `/admin/listening/audit${query.size ? `?${query}` : ''}`;
}

export function listeningAuditDetailRollbackHref(id) {
  return `/pages/admin/listening/audit-detail.html?id=${encodeURIComponent(textOf(id))}`;
}

export function normalizeListeningAuditInventoryPage(raw, expected = {}) {
  const value = normalizeListeningTestList(raw, expected);
  if (!value || value.malformedCount) return null;
  return value;
}

function normalizeIssue(raw) {
  const value = objectOf(raw);
  const qNum = value?.q_num == null ? null : integer(value.q_num);
  const severity = textOf(value?.severity);
  const dimension = textOf(value?.dimension);
  const code = textOf(value?.code);
  const message = textOf(value?.message);
  if (!value || (value.q_num != null && (qNum == null || qNum < 1)) || !['error', 'warning'].includes(severity)
    || !dimension || !code || !message || typeof value.resolved !== 'boolean') return null;
  return { qNum, severity, dimension, code, message, resolved: value.resolved };
}

function normalizeHealth(raw, issues, allowEmpty = false) {
  const value = objectOf(raw);
  if (allowEmpty && value && Object.keys(value).length === 0) return null;
  const errorCount = integer(value?.error_count);
  const warningCount = integer(value?.warning_count);
  const status = textOf(value?.status);
  if (!value || errorCount == null || errorCount < 0 || warningCount == null || warningCount < 0
    || !['passed', 'has_issues'].includes(status) || (errorCount > 0) !== (status === 'has_issues')) return null;
  if (issues) {
    const actualErrors = issues.filter((issue) => issue.severity === 'error' && !issue.resolved).length;
    const actualWarnings = issues.filter((issue) => issue.severity === 'warning' && !issue.resolved).length;
    if (actualErrors !== errorCount || actualWarnings !== warningCount) return null;
  }
  return { errorCount, warningCount, status };
}

function normalizeSaved(raw, expectedId) {
  if (raw == null) return { status: 'pending', health: null, auditedAt: null, updatedAt: null };
  const value = objectOf(raw);
  const status = textOf(value?.status);
  const savedTestId = textOf(value?.test_id);
  const issuesRaw = Array.isArray(value?.issues) ? value.issues : null;
  if (!value || !SAVED_STATUSES.has(status) || (savedTestId && savedTestId !== expectedId) || !issuesRaw) return null;
  const issues = issuesRaw.map(normalizeIssue);
  if (issues.some((issue) => !issue)) return null;
  // Saved health is the immutable roll-up from the last full run. Human triage
  // may later mark issues resolved without recomputing that historical roll-up,
  // so validate its own shape but do not force it to equal current issue flags.
  const health = normalizeHealth(value.health, null, status === 'pending');
  if (status !== 'pending' && !health) return null;
  return { status, health, auditedAt: nullableText(value.audited_at), updatedAt: nullableText(value.updated_at) };
}

export function normalizeListeningAuditSnapshot(raw, expected) {
  const value = objectOf(raw);
  const id = textOf(value?.uuid);
  const testId = textOf(value?.test_id);
  const status = textOf(value?.status);
  const type = textOf(value?.test_type);
  const questionCount = integer(value?.question_count);
  const sectionCount = integer(value?.section_count);
  const live = objectOf(value?.live);
  const liveIssuesRaw = Array.isArray(live?.issues) ? live.issues : null;
  if (!value || id !== expected.id || testId !== expected.testId || !TEST_STATUSES.has(status)
    || !TEST_TYPES.has(type) || type === 'all' || questionCount == null || questionCount < 0
    || sectionCount == null || sectionCount < 0 || !live || !liveIssuesRaw) return null;
  const liveIssues = liveIssuesRaw.map(normalizeIssue);
  if (liveIssues.some((issue) => !issue)) return null;
  const liveHealth = normalizeHealth(live.health, liveIssues);
  const saved = normalizeSaved(value.saved, id);
  if (!liveHealth || !saved) return null;
  return { id, testId, title: textOf(value.title) || testId, status, type, questionCount, sectionCount,
    live: { ...liveHealth, issueCount: liveIssues.length }, saved };
}

export function classifyListeningAudit(state) {
  if (!state || state.phase !== 'ready') return state?.phase === 'error' ? 'lookup' : 'loading';
  if (state.value.live.errorCount > 0) return 'error';
  if (state.value.live.warningCount > 0) return 'warning';
  return 'clean';
}

export function filterListeningAuditRows(rows, filters = {}) {
  const value = normalizeListeningAuditFilters(filters);
  const query = value.search.toLocaleLowerCase('vi');
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const health = classifyListeningAudit(row.audit);
    const saved = row.audit?.phase === 'ready' ? row.audit.value.saved.status : null;
    const searchMatches = !query || `${row.test.testId} ${row.test.title}`.toLocaleLowerCase('vi').includes(query);
    return searchMatches && (value.type === 'all' || row.test.type === value.type)
      && (value.health === 'all' || health === value.health)
      && (value.saved === 'all' || saved === value.saved);
  });
}

export function summarizeListeningAuditRows(rows) {
  const summary = { total: 0, loading: 0, lookup: 0, error: 0, warning: 0, clean: 0, savedPending: 0 };
  for (const row of Array.isArray(rows) ? rows : []) {
    summary.total += 1;
    const health = classifyListeningAudit(row.audit);
    summary[health] += 1;
    if (row.audit?.phase === 'ready' && row.audit.value.saved.status === 'pending') summary.savedPending += 1;
  }
  return summary;
}

export function formatListeningAuditDate(value) {
  const raw = textOf(value);
  if (!raw) return 'chưa có';
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? 'không hợp lệ' : date.toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
}
