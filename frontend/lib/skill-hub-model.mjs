// Pure helpers for the skill hub (LEARNERCORE-0063 T25, FR-111..118). The
// server decides metering, suggestions and results; these only read the
// payload defensively and turn it into Vietnamese copy.

export const SKILLS = Object.freeze(['speaking', 'writing', 'listening', 'reading']);

export const SKILL_LABELS = Object.freeze({
  speaking: 'Speaking', writing: 'Writing', listening: 'Listening', reading: 'Reading',
});

// The four hubs, Speaking · Writing · Listening · Reading (FR-079 order).
export const SKILL_HUB_HREFS = Object.freeze({
  speaking: '/speaking', writing: '/writing/dashboard', listening: '/listening', reading: '/reading',
});

const BLOCKS = new Set(['credits', 'resume', 'suggestions', 'catalog', 'history']);
const VN_DATE = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric',
});

function recordOf(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function intOf(value) {
  return Number.isInteger(value) ? value : null;
}

function numberOf(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function listOf(value) {
  return Array.isArray(value) ? value : [];
}

/** A relative app path only: never an absolute or protocol-relative URL. */
function hrefOf(value) {
  const text = textOf(value);
  return text.startsWith('/') && !text.startsWith('//') ? text : null;
}

function normalizeResult(value) {
  const r = recordOf(value) || {};
  return {
    band: numberOf(r.band),
    correct: intOf(r.correct),
    total: intOf(r.total),
    pending: r.pending === true,
  };
}

export function normalizeSkillHub(raw, skill) {
  const body = recordOf(raw);
  if (!body || body.skill !== skill) return null;
  const credits = recordOf(body.credits);
  const metering = ['metered', 'not_metered', 'unknown'].includes(credits?.metering) ? credits.metering : null;
  const starter = recordOf(body.starter);
  return {
    skill,
    credits: credits && intOf(credits.total) !== null && metering
      ? { total: credits.total, metering } : null,
    resume: listOf(body.resume).map(recordOf).filter(Boolean).flatMap((r) => {
      const href = hrefOf(r.href);
      const title = textOf(r.title);
      return href && title ? [{ kind: textOf(r.kind), title, state: textOf(r.state), href,
        updatedAt: textOf(r.updated_at) || null }] : [];
    }),
    starter: starter && hrefOf(starter.href) && textOf(starter.title)
      ? { title: textOf(starter.title), meta: textOf(starter.meta) || null,
          usesCredit: starter.uses_credit === true, href: hrefOf(starter.href) }
      : null,
    suggestions: listOf(body.suggestions).map(recordOf).filter(Boolean).flatMap((s) => {
      const href = hrefOf(s.href);
      const title = textOf(s.title);
      return href && title ? [{ kind: textOf(s.kind), title, why: textOf(s.why), href }] : [];
    }).slice(0, 3),
    catalog: listOf(body.catalog).map(recordOf).filter(Boolean).flatMap((g) => {
      const href = hrefOf(g.href);
      const label = textOf(g.label);
      return href && label ? [{ group: textOf(g.group), label, count: intOf(g.count),
        done: intOf(g.done), href }] : [];
    }),
    catalogHref: hrefOf(body.catalog_href),
    history: listOf(body.history).map(recordOf).filter(Boolean).flatMap((h) => {
      const title = textOf(h.title);
      return title ? [{ submittedAt: textOf(h.submitted_at) || null, title, kind: textOf(h.kind),
        source: textOf(h.source), result: normalizeResult(h.result), href: hrefOf(h.href) }] : [];
    }).slice(0, 5),
    historyHref: hrefOf(body.history_href),
    blocked: recordOf(body.access)?.blocked === true,
    degraded: new Set(listOf(body.degraded).filter((key) => BLOCKS.has(key))),
  };
}

/**
 * FR-116: only a metered skill with nothing left is "out of credits".
 * `not_metered` and `unknown` never are, whatever the balance says.
 */
export function creditsEmpty(credits) {
  return Boolean(credits) && credits.metering === 'metered' && credits.total === 0;
}

const SOURCE_COPY = {
  ai_instant: 'AI chấm, trả ngay',
  teacher_review: 'AI chấm, giáo viên duyệt rồi trả',
  auto: 'Tự chấm',
};

export function sourceCopy(source) {
  return SOURCE_COPY[source] || '';
}

/**
 * FR-077: a band only when the server sent one; a score only as "a trên b câu"
 * with b > 0; never "0/0" or a lone dash. Empty string = show nothing.
 */
export function resultCopy(result) {
  if (!result) return '';
  if (result.band !== null) return `Band ${result.band.toFixed(1)}`;
  if (result.total !== null && result.total > 0 && result.correct !== null) {
    return `Đúng ${result.correct} trên ${result.total} câu`;
  }
  return result.pending ? 'Đang chấm' : '';
}

export function vnDateCopy(value) {
  const time = Date.parse(textOf(value));
  return Number.isFinite(time) ? VN_DATE.format(new Date(time)) : null;
}

export function catalogMetaCopy(group) {
  const parts = [];
  if (group.count !== null) parts.push(`${group.count} đề`);
  if (group.done !== null) parts.push(`đã làm ${group.done}`);
  return parts.join(' · ');
}

/** `?view=all` keeps the existing page reachable while the hub is on. */
export function wantsClassicView(search) {
  try {
    return new URLSearchParams(search || '').get('view') === 'all';
  } catch {
    return false;
  }
}

/** `/reading` with the flag off: the old redirect target, query kept. */
export function readingFallbackHref(search) {
  const query = textOf(search).replace(/^\?/, '');
  return query ? `/reading/vocab?${query}` : '/reading/vocab';
}
