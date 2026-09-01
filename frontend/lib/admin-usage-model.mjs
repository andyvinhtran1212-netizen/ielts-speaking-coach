const SORTS = new Set(['sessions', 'last_active', 'ai_cost_usd', 'name']);

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function count(value, nullable = false) {
  if (nullable && value == null) return null;
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function cost(value, nullable = false) {
  if (nullable && value == null) return null;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function timestamp(value) {
  if (value == null) return null;
  const normalized = text(value);
  return normalized && Number.isFinite(Date.parse(normalized)) ? normalized : undefined;
}

function normalizeUser(value) {
  const row = record(value);
  if (!row) return null;
  const userId = text(row.user_id);
  const sessions = count(row.sessions, true);
  const lastActive = timestamp(row.last_active);
  const aiCostUsd = cost(row.ai_cost_usd, true);
  if (!userId || sessions === undefined || lastActive === undefined || aiCostUsd === undefined) return null;
  return {
    userId,
    email: text(row.email),
    name: text(row.name),
    role: text(row.role),
    sessions,
    lastActive,
    aiCostUsd,
  };
}

function normalizeUsers(value) {
  if (!Array.isArray(value)) return null;
  const rows = [];
  const seen = new Set();
  let malformedCount = 0;
  for (const raw of value) {
    const row = normalizeUser(raw);
    if (!row || seen.has(row.userId)) {
      malformedCount += 1;
      continue;
    }
    seen.add(row.userId);
    rows.push(row);
  }
  return { rows, malformedCount };
}

export function normalizeUsageUsersPayload(value) {
  return normalizeUsers(value);
}

export function normalizeCodeUsagePayload(value) {
  const payload = record(value);
  const codeRow = record(payload?.code);
  const aggregate = record(payload?.aggregate);
  const users = normalizeUsers(payload?.assigned_users);
  if (!payload || !codeRow || !aggregate || !users) return null;

  const codeId = text(codeRow.id);
  const codeValue = text(codeRow.code);
  const sessionLimit = count(codeRow.session_limit, true);
  const assignedUserCount = count(aggregate.assigned_user_count);
  const totalSessions = count(aggregate.total_sessions, true);
  const totalAiCostUsd = cost(aggregate.total_ai_cost_usd, true);
  if (!codeId || !codeValue || sessionLimit === undefined || assignedUserCount === undefined
      || totalSessions === undefined || totalAiCostUsd === undefined) return null;

  return {
    code: {
      id: codeId,
      value: codeValue,
      codeType: text(codeRow.code_type),
      cohortId: text(codeRow.cohort_id),
      sessionLimit,
    },
    rows: users.rows,
    aggregate: { assignedUserCount, totalSessions, totalAiCostUsd },
    malformedCount: users.malformedCount,
  };
}

export function filterUsageRows(rows, query) {
  const needle = String(query || '').trim().toLocaleLowerCase('vi-VN');
  if (!needle) return [...(rows || [])];
  return (rows || []).filter((row) => [row.name, row.email, row.userId]
    .some((value) => String(value || '').toLocaleLowerCase('vi-VN').includes(needle)));
}

export function sortUsageRows(rows, sort = 'sessions') {
  const field = SORTS.has(sort) ? sort : 'sessions';
  return [...(rows || [])].sort((left, right) => {
    if (field === 'name') {
      const a = left.name || left.email || left.userId;
      const b = right.name || right.email || right.userId;
      return a.localeCompare(b, 'vi');
    }
    const key = field === 'last_active' ? 'lastActive' : field === 'ai_cost_usd' ? 'aiCostUsd' : 'sessions';
    const a = key === 'lastActive' && left[key] ? Date.parse(left[key]) : left[key];
    const b = key === 'lastActive' && right[key] ? Date.parse(right[key]) : right[key];
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    return b - a;
  });
}

export function summarizeUsageRows(rows) {
  const list = rows || [];
  return {
    users: list.length,
    activeUsers: list.some((row) => row.sessions == null) ? null : list.filter((row) => row.lastActive != null).length,
    sessions: list.some((row) => row.sessions == null) ? null : list.reduce((sum, row) => sum + row.sessions, 0),
    aiCostUsd: list.some((row) => row.aiCostUsd == null) ? null : list.reduce((sum, row) => sum + row.aiCostUsd, 0),
    degradedRows: list.filter((row) => row.sessions == null || row.aiCostUsd == null).length,
  };
}

export function usageUserLabel(row) {
  return row?.name || row?.email || row?.userId || 'Người dùng không rõ';
}

export function formatUsageCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value.toLocaleString('vi-VN') : '—';
}

export function formatUsageCost(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? `$${value.toFixed(4)}` : '—';
}

export function formatUsageDate(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return '—';
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(value));
}
