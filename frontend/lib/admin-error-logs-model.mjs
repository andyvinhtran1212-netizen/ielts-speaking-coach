const LEVELS = new Set(['error', 'warning', 'info']);
const SOURCES = new Set(['frontend', 'backend']);

export function finiteNumber(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function truncate(value, length) {
  if (!value) return '—';
  const text = String(value);
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

export function formatLogTime(value, locale = 'vi-VN') {
  if (typeof value !== 'string' || !value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(locale, {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

export function normalizeErrorRow(value) {
  if (!value || typeof value !== 'object' || typeof value.id !== 'string') return null;
  const level = LEVELS.has(value.level) ? value.level : 'error';
  const source = SOURCES.has(value.source) ? value.source : 'backend';
  return {
    id: value.id,
    level,
    source,
    message: typeof value.message === 'string' ? value.message : '',
    stack: typeof value.stack === 'string' ? value.stack : null,
    url: typeof value.url === 'string' ? value.url : null,
    user_id: typeof value.user_id === 'string' ? value.user_id : null,
    user_agent: typeof value.user_agent === 'string' ? value.user_agent : null,
    request_id: typeof value.request_id === 'string' ? value.request_id : null,
    occurred_at: typeof value.occurred_at === 'string' ? value.occurred_at : null,
    dismissed_at: typeof value.dismissed_at === 'string' ? value.dismissed_at : null,
    extra: value.extra && typeof value.extra === 'object' && !Array.isArray(value.extra)
      ? value.extra : null,
  };
}

export function normalizeLogsPayload(value, fallbackLimit = 50, fallbackOffset = 0) {
  const raw = value && typeof value === 'object' ? value : {};
  const items = Array.isArray(raw.items)
    ? raw.items.map(normalizeErrorRow).filter(Boolean)
    : [];
  return {
    items,
    limit: finiteNumber(raw.limit) ?? fallbackLimit,
    offset: finiteNumber(raw.offset) ?? fallbackOffset,
  };
}

export function normalizeStatsPayload(value) {
  const raw = value && typeof value === 'object' ? value : {};
  return {
    total: finiteNumber(raw.total),
    undismissed: finiteNumber(raw.undismissed),
    last24h: finiteNumber(raw.last_24h),
    last7d: finiteNumber(raw.last_7d),
  };
}

export function normalizeMigrationPayload(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const rows = Array.isArray(raw.rows) ? raw.rows.filter((row) => row && typeof row === 'object').map((row) => ({
    implementation: typeof row.implementation === 'string' ? row.implementation : 'untagged',
    release: typeof row.release === 'string' ? row.release : 'untagged',
    total: finiteNumber(row.total) ?? 0,
    undismissed: finiteNumber(row.undismissed) ?? 0,
    byLevel: row.by_level && typeof row.by_level === 'object' && !Array.isArray(row.by_level)
      ? Object.entries(row.by_level).filter(([, count]) => finiteNumber(count) != null)
      : [],
  })) : [];
  return {
    windowDays: finiteNumber(raw.window_days) ?? 7,
    rows,
    scanned: finiteNumber(raw.scanned) ?? 0,
    truncated: raw.truncated === true,
  };
}

function pyReprDetails(message) {
  const match = message.match(/'details':\s*'((?:\\.|[^'\\])*)'/)
    || message.match(/'details':\s*"((?:\\.|[^"\\])*)"/);
  if (!match) return undefined;
  return match[1]
    .replace(/\\([nrt'"\\])/g, (_, character) => (
      character === 'n' || character === 't' ? ' ' : character === 'r' ? '' : character
    ))
    .replace(/\\[nrt]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Keep the production-tested legacy categorisation while React owns escaping. */
export function humanizeError(row) {
  const message = String(row?.message || '');
  if (/test exception|manual fire test|manual warning|dogfood|unhandled rejection test|manual report/i.test(message)) {
    return { category: 'Thử nghiệm', tone: 'muted', noise: true, summary: 'Mục thử nghiệm — không phải lỗi thật' };
  }
  if (/zalojsv2|zalosdk|\bgmo\b|\bfbq\b|gtag|adsbygoogle|google[- ]analytics/i.test(message)
      || message.trim() === 'Script error.' || message.trim() === 'Script error') {
    return { category: 'Bên thứ 3', tone: 'muted', noise: true, summary: 'Lỗi từ tiện ích/quảng cáo bên ngoài — không phải lỗi của ứng dụng' };
  }

  const codeMatch = message.match(/'code':\s*(?:'([^']*)'|(\d+))/);
  const code = codeMatch
    ? (codeMatch[1] !== undefined ? codeMatch[1] : codeMatch[2])
    : undefined;
  if (/JSON could not be generated/i.test(message) && code !== undefined && /^\d{3}$/.test(String(code))) {
    const details = pyReprDetails(message);
    const transient = Number(code) >= 500;
    return {
      category: 'Mạng', tone: transient ? 'warning' : 'error', noise: false,
      summary: `Dịch vụ Supabase trả HTTP ${code}`
        + (transient ? ' (sự cố nền tảng, thường tạm thời)' : ' (lỗi cổng API)')
        + (details ? ` — ${truncate(details, 60)}` : ''),
    };
  }

  if (code || /schema cache|violates .*constraint|does not exist|null value in column/i.test(message)) {
    const inner = (message.match(/'message':\s*'([^']*)'/)
      || message.match(/'message':\s*"([^"]*)"/)
      || [null, message])[1] || message;
    const column = (inner.match(/column\s+"?([\w.]+)"?/i) || [])[1];
    const tableMatch = inner.match(/relation\s+"([\w.]+)"/i) || inner.match(/table '([\w.]+)'/i) || [];
    const table = tableMatch[1];
    let summary;
    if (code === '23502') summary = `Thiếu dữ liệu bắt buộc ở cột "${column || '?'}"`;
    else if (code === '23505') summary = `Bị trùng giá trị (không cho phép trùng)${column ? ` ở "${column}"` : ''}`;
    else if (code === '42703') summary = `Cột "${column || '?'}" không tồn tại (lệch schema)`;
    else if (code === 'PGRST205' || code === '42P01') summary = `Bảng "${table || '?'}" không tồn tại (lệch schema)`;
    else if (code === '23503') summary = 'Vi phạm khoá ngoại (dữ liệu tham chiếu không tồn tại)';
    else summary = (inner || 'Lỗi truy vấn CSDL').slice(0, 100);
    return { category: 'CSDL', tone: 'error', noise: false, summary: summary + (table ? ` — bảng ${table}` : '') };
  }

  if (/certificate_verify_failed|\bssl\b|server disconnected|timed? ?out|connection|econnrefused/i.test(message)) {
    return { category: 'Mạng', tone: 'warning', noise: false, summary: 'Lỗi kết nối tới dịch vụ bên ngoài (thường tạm thời)' };
  }
  if (row?.source === 'frontend') {
    const match = message.match(/Cannot read properties of (\w+) \(reading '([^']+)'\)/)
      || message.match(/([\w$]+) is not defined/);
    if (match && match[2]) return { category: 'Giao diện', tone: 'error', noise: false, summary: `Truy cập "${match[2]}" trên giá trị ${match[1]} (thiếu kiểm tra null)` };
    if (match && match[1]) return { category: 'Giao diện', tone: 'error', noise: false, summary: `Biến "${match[1]}" chưa được định nghĩa` };
    return { category: 'Giao diện', tone: 'error', noise: false, summary: truncate(message, 90) };
  }
  if (/^'[\w ]+'$/.test(message.trim())) {
    return { category: 'Máy chủ', tone: 'error', noise: false, summary: `Thiếu khoá/giá trị: ${message.trim()}` };
  }
  return { category: 'Khác', tone: '', noise: false, summary: truncate(message, 90) };
}

export function normalizeRollbackPayload(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const implementations = raw.implementations && typeof raw.implementations === 'object'
    ? raw.implementations : {};
  return {
    route: typeof raw.route === 'string' ? raw.route : '/',
    match: raw.match === 'prefix' ? 'prefix' : 'exact',
    matchCoercedFrom: typeof raw.match_coerced_from === 'string' ? raw.match_coerced_from : null,
    windowMinutes: finiteNumber(raw.window_minutes) ?? 30,
    requestedWindowMinutes: finiteNumber(raw.window_minutes_requested),
    windowClamped: raw.window_clamped === true,
    windows: raw.windows && typeof raw.windows === 'object' ? raw.windows : {},
    exposure: raw.exposure && typeof raw.exposure === 'object' ? raw.exposure : null,
    implementations,
    errorVerdict: raw.error_verdict && typeof raw.error_verdict === 'object' ? raw.error_verdict : null,
    vitalsVerdict: raw.vitals_verdict && typeof raw.vitals_verdict === 'object' ? raw.vitals_verdict : null,
    truncated: raw.truncated === true,
  };
}

export function formatWindow(minutes) {
  const value = finiteNumber(minutes) ?? 0;
  if (value >= 1440) return `${(value / 1440).toFixed(value % 1440 ? 1 : 0)} ngày`;
  if (value >= 60) return `${(value / 60).toFixed(value % 60 ? 1 : 0)} giờ`;
  return `${value} phút`;
}
