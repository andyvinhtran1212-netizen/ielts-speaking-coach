const WINDOWS = new Set([7, 30, 90]);

export function normalizeWindowDays(value) {
  const parsed = Number(value);
  return WINDOWS.has(parsed) ? parsed : 30;
}

export function finiteNumber(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeSeries(value) {
  if (!Array.isArray(value)) return [];
  return value.map((point) => {
    const source = point && typeof point === 'object' ? point.value : point;
    return finiteNumber(source) ?? 0;
  });
}

export function chartPoints(values, width, height, pad) {
  const nums = normalizeSeries(values);
  if (nums.length < 2) return [];
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min || 1;
  const innerWidth = width - pad * 2;
  const innerHeight = height - pad * 2;
  return nums.map((value, index) => ({
    x: Math.round((pad + (index / (nums.length - 1)) * innerWidth) * 100) / 100,
    y: Math.round((pad + innerHeight - ((value - min) / span) * innerHeight) * 100) / 100,
  }));
}

export function periodDelta(values) {
  const nums = normalizeSeries(values);
  if (nums.length < 4) return null;
  const midpoint = Math.floor(nums.length / 2);
  const prior = nums.slice(0, midpoint).reduce((sum, value) => sum + value, 0);
  const recent = nums.slice(midpoint).reduce((sum, value) => sum + value, 0);
  if (prior === 0) {
    return recent > 0 ? { pct: null, dir: 'up' } : { pct: 0, dir: 'flat' };
  }
  const pct = Math.round(((recent - prior) / prior) * 100);
  return { pct, dir: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat' };
}

export function safeActivityLink(value) {
  if (typeof value !== 'string') return null;
  const link = value.trim();
  if (!link.startsWith('/') || link.startsWith('//') || link.includes('\\') || /[\u0000-\u001f\u007f]/.test(link)) {
    return null;
  }
  return link;
}

export function formatInteger(value, locale = 'vi-VN') {
  const number = finiteNumber(value);
  return number == null ? '—' : number.toLocaleString(locale);
}

export function formatTokens(value) {
  const number = finiteNumber(value);
  if (number == null) return '—';
  const unit = (divisor, suffix) => `${(number / divisor).toFixed(1).replace(/\.0$/, '')}${suffix}`;
  if (number >= 1e9) return unit(1e9, 'B');
  if (number >= 1e6) return unit(1e6, 'M');
  if (number >= 1e3) return unit(1e3, 'K');
  return String(number);
}

export function normalizePartialFailures(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  for (const block of value) {
    if (typeof block !== 'string') continue;
    const name = block.trim();
    if (name) seen.add(name);
  }
  return [...seen];
}

export function normalizeOverviewPayload(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const activity = Array.isArray(raw.recent_activity)
    ? raw.recent_activity.filter((row) => row && typeof row === 'object' && row.timestamp)
    : [];
  return {
    students: raw.students && typeof raw.students === 'object' ? raw.students : {},
    skills: raw.skills && typeof raw.skills === 'object' ? raw.skills : {},
    errors: raw.errors && typeof raw.errors === 'object' ? raw.errors : {},
    accessCodes: raw.access_codes && typeof raw.access_codes === 'object' ? raw.access_codes : {},
    recentActivity: activity,
    generatedAt: typeof raw.generated_at === 'string' ? raw.generated_at : null,
    partialFailures: normalizePartialFailures(raw.partial_failures),
  };
}

// GET /admin/overview reports a failed read as a block name in
// `partial_failures` and returns 0/[] for it (backend/routers/admin_overview.py).
// Each block maps to the rendered values it feeds, so those values show
// "chưa tải được" instead of a silent zero.
export const PARTIAL_FAILURE_STAT_LABELS = Object.freeze({
  'students.total': 'Tổng học viên',
  'students.active_7d': 'Đang hoạt động (7 ngày)',
  'students.active_30d': 'Hoạt động 30 ngày',
  'errors.undismissed': 'Lỗi chưa xử lý',
  'errors.last_24h': 'Lỗi trong 24h',
  'access_codes.active': 'Mã đang dùng',
  'speaking.sessions_7d': 'Speaking 7 ngày',
  'speaking.sessions_total': 'Speaking tổng',
  'speaking.avg_band_7d': 'Speaking Band TB',
  'writing.essays_7d': 'Writing 7 ngày',
  'writing.essays_total': 'Writing tổng',
  'writing.feedback_pending': 'Writing chưa trả kết quả',
  'reading.attempts_7d': 'Reading 7 ngày',
  'reading.attempts_total': 'Reading tổng',
  'reading.avg_score_7d': 'Reading đúng TB',
  'listening.attempts_7d': 'Listening 7 ngày',
  'listening.attempts_total': 'Listening tổng',
  'listening.avg_score_7d': 'Listening đúng TB',
  'listening.dictation_7d': 'Chép chính tả 7 ngày',
  'vocab.due_review_today': 'Vocab đang học',
  'vocab.words_total': 'Vocab tổng',
  'grammar.articles_viewed_7d': 'Grammar đề xuất 7 ngày',
  activity: 'Hoạt động gần đây',
});

// Activity windows (*_recent) also feed the active-student counts and the
// recent-activity feed. Blocks whose values this page does not render still
// carry a label so the banner never drops a failure.
const PARTIAL_FAILURE_BLOCKS = Object.freeze({
  students: { stats: ['students.total', 'students.active_7d', 'students.active_30d', 'activity'] },
  cohorts: { stats: [], labels: ['Phân bố theo lớp'] },
  sessions_recent: { stats: ['speaking.sessions_7d', 'speaking.avg_band_7d', 'students.active_7d', 'students.active_30d', 'activity'] },
  sessions_total: { stats: ['speaking.sessions_total'] },
  essays_recent: { stats: ['writing.essays_7d', 'students.active_7d', 'students.active_30d', 'activity'] },
  essays_total: { stats: ['writing.essays_total'] },
  essays_pending: { stats: ['writing.feedback_pending'] },
  reading_recent: { stats: ['reading.attempts_7d', 'reading.avg_score_7d', 'students.active_7d', 'students.active_30d', 'activity'] },
  reading_total: { stats: ['reading.attempts_total'] },
  listening_recent: { stats: ['listening.attempts_7d', 'listening.avg_score_7d', 'students.active_7d', 'students.active_30d', 'activity'] },
  listening_total: { stats: ['listening.attempts_total'] },
  dictation_recent: { stats: ['listening.dictation_7d', 'students.active_7d', 'students.active_30d', 'activity'] },
  dictation_total: { stats: [], labels: ['Chép chính tả tổng'] },
  listening_content_count: { stats: [], labels: ['Số đề Listening'] },
  vocab_total: { stats: ['vocab.words_total'] },
  vocab_learning: { stats: ['vocab.due_review_today'] },
  grammar_recent: { stats: ['grammar.articles_viewed_7d'] },
  errors_undismissed: { stats: ['errors.undismissed'] },
  errors_24h: { stats: ['errors.last_24h'] },
  errors_7d: { stats: [], labels: ['Lỗi 7 ngày'] },
  access_codes: { stats: ['access_codes.active'] },
  activity_emails: { stats: ['activity'] },
});

export const KNOWN_PARTIAL_FAILURE_BLOCKS = Object.freeze(Object.keys(PARTIAL_FAILURE_BLOCKS));

function knownBlock(block) {
  return Object.prototype.hasOwnProperty.call(PARTIAL_FAILURE_BLOCKS, block)
    ? PARTIAL_FAILURE_BLOCKS[block] : null;
}

// Rendered value keys (PARTIAL_FAILURE_STAT_LABELS) whose number is not trustworthy.
export function partialFailureStats(blocks) {
  const stats = new Set();
  for (const block of normalizePartialFailures(blocks)) {
    for (const stat of knownBlock(block)?.stats || []) stats.add(stat);
  }
  return stats;
}

// Human labels for the banner, in block order, de-duplicated. Unknown block
// names are listed raw so a new backend block is never silently dropped.
export function partialFailureTiles(blocks) {
  const labels = [];
  for (const block of normalizePartialFailures(blocks)) {
    const entry = knownBlock(block);
    const next = entry
      ? [...entry.stats.map((stat) => PARTIAL_FAILURE_STAT_LABELS[stat]), ...(entry.labels || [])]
      : [block];
    for (const label of next) if (!labels.includes(label)) labels.push(label);
  }
  return labels;
}

export function normalizeOpsPayload(value, requestedWindow) {
  const raw = value && typeof value === 'object' ? value : {};
  const visitors = raw.distinct_visitors && typeof raw.distinct_visitors === 'object'
    ? raw.distinct_visitors : {};
  const tokens = raw.tokens_called && typeof raw.tokens_called === 'object'
    ? raw.tokens_called : {};
  const attention = raw.attention && typeof raw.attention === 'object' ? raw.attention : {};
  return {
    totalUsers: finiteNumber(raw.total_users),
    activeCodes: finiteNumber(raw.active_codes),
    totalPractices: finiteNumber(raw.total_practices),
    gradingMinutes: finiteNumber(raw.grading_minutes),
    visitors: {
      count: finiteNumber(visitors.count),
      authenticated: finiteNumber(visitors.authenticated),
      anonymous: finiteNumber(visitors.anonymous),
      windowDays: normalizeWindowDays(visitors.window_days ?? requestedWindow),
    },
    tokens: {
      count: finiteNumber(tokens.count),
      windowDays: normalizeWindowDays(tokens.window_days ?? requestedWindow),
    },
    attention: {
      errorsUndismissed: finiteNumber(attention.errors_undismissed),
      writingPending: finiteNumber(attention.writing_pending),
    },
    computedAt: typeof raw.computed_at === 'string' ? raw.computed_at : null,
  };
}

export function normalizeTrendsPayload(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const series = raw.series && typeof raw.series === 'object' ? raw.series : {};
  return {
    visitors: normalizeSeries(series.visitors),
    practices: normalizeSeries(series.practices),
    tokens: normalizeSeries(series.tokens),
  };
}
