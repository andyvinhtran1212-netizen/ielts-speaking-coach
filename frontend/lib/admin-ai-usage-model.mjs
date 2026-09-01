const KNOWN_SERVICES = ['claude', 'gemini', 'whisper', 'tts'];

function finite(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeService(value) {
  if (!value || typeof value !== 'object') return null;
  const calls = finite(value.calls);
  const cost = finite(value.cost_usd);
  if (calls == null || cost == null) return null;
  return { calls, cost };
}

function normalizeServices(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const services = {};
  let malformedCount = 0;
  for (const [name, raw] of Object.entries(value)) {
    const normalized = normalizeService(raw);
    if (!normalized) malformedCount += 1;
    else services[name] = normalized;
  }
  return { services, malformedCount };
}

export function normalizeAiUsagePayload(value) {
  if (!value || typeof value !== 'object' || !value.overall || !Array.isArray(value.per_user) || !value.meta) return null;
  const calls = finite(value.overall.calls);
  const cost = finite(value.overall.cost_usd);
  const overallServices = normalizeServices(value.overall.by_service);
  if (calls == null || cost == null || !overallServices) return null;

  let malformedCount = overallServices.malformedCount;
  const users = [];
  for (const raw of value.per_user) {
    if (!raw || typeof raw !== 'object') { malformedCount += 1; continue; }
    const userId = text(raw.user_id);
    const userCalls = finite(raw.calls);
    const userCost = finite(raw.cost_usd);
    const byService = normalizeServices(raw.by_service);
    if (!userId || userCalls == null || userCost == null || !byService) { malformedCount += 1; continue; }
    malformedCount += byService.malformedCount;
    users.push({
      userId,
      email: text(raw.email),
      displayName: text(raw.display_name),
      calls: userCalls,
      cost: userCost,
      services: byService.services,
    });
  }

  const queryLimit = finite(value.meta.query_limit);
  const returnedRows = finite(value.meta.returned_rows);
  const totalMatchingRows = finite(value.meta.total_matching_rows);
  if (queryLimit == null || returnedRows == null) return null;
  return {
    overall: { calls, cost, services: overallServices.services },
    users,
    meta: { queryLimit, returnedRows, totalMatchingRows, truncated: value.meta.truncated === true },
    malformedCount,
  };
}

export function serviceRows(services) {
  const entries = Object.entries(services || {});
  return entries.sort(([left], [right]) => {
    const leftIndex = KNOWN_SERVICES.indexOf(left);
    const rightIndex = KNOWN_SERVICES.indexOf(right);
    if (leftIndex >= 0 && rightIndex >= 0) return leftIndex - rightIndex;
    if (leftIndex >= 0) return -1;
    if (rightIndex >= 0) return 1;
    return left.localeCompare(right);
  });
}

export function formatUsd(value) {
  const number = finite(value);
  return number == null ? '—' : `$${number.toFixed(4)}`;
}

export function formatCount(value) {
  const number = finite(value);
  return number == null ? '—' : number.toLocaleString('vi-VN');
}

export function serviceLabel(value) {
  return ({ claude: 'Claude', gemini: 'Gemini', whisper: 'Whisper', tts: 'TTS' })[value] || value || 'Không rõ';
}

export function coverageMessage(meta) {
  if (!meta) return null;
  if (meta.truncated) return `Đang hiển thị ít nhất ${formatCount(meta.returnedRows)} lượt gọi; dữ liệu đã chạm giới hạn ${formatCount(meta.queryLimit)} log.`;
  if (meta.totalMatchingRows == null) return `Đã tổng hợp ${formatCount(meta.returnedRows)} log; backend chưa xác nhận tổng số bản ghi khớp.`;
  return `Đã tổng hợp đủ ${formatCount(meta.returnedRows)} / ${formatCount(meta.totalMatchingRows)} log trong phạm vi.`;
}
