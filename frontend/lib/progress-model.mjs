// Pure helpers for /progress (LEARNERCORE-0063 FR-061, FR-077).
//
// One row per skill, built only from APIs that already exist:
//   Speaking  GET /sessions?status=completed&page=1&page_size=5
//   Writing   GET /api/writing/my-essays
//   Listening GET /api/listening/overview
//   Từ vựng   GET /api/quiz/progress?skill_area=vocab
// A band is printed only under the FR-077 rule (a graded Speaking session or a
// delivered Writing essay that carries one). Listening attempts here have no
// band from the server, so the row shows "Đúng a trên b câu" (b > 0). Nothing
// is guessed: no "0/0", no lone dash, no internal codes.

const isBand = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
const formatBand = (v) => `Band ${v.toFixed(1)}`;
const count = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);

/** `GET /sessions` (paged or legacy list) → row facts. */
export function speakingRow(raw) {
  const sessions = Array.isArray(raw) ? raw : Array.isArray(raw?.sessions) ? raw.sessions : null;
  if (!sessions) return null;
  const graded = sessions.filter((s) => s && s.status === 'completed');
  const done = Array.isArray(raw) ? graded.length : count(raw.total);
  const latest = graded.find((s) => isBand(s.overall_band));
  return {
    done: done ? `${done} buổi đã chấm` : 'Chưa có buổi nào',
    result: latest ? formatBand(latest.overall_band) : done ? 'Chưa có band' : null,
  };
}

const PENDING_WRITING = new Set(['submitted', 'grading', 'graded', 'reviewed']);

/** `GET /api/writing/my-essays` → row facts. */
export function writingRow(raw) {
  const essays = Array.isArray(raw?.essays) ? raw.essays : null;
  if (!essays) return null;
  const sent = essays.filter((e) => e && typeof e.status === 'string' && e.status !== 'draft');
  const latestBand = sent.find((e) => e.status === 'delivered' && isBand(e.overall_band_score));
  const pending = sent.filter((e) => PENDING_WRITING.has(e.status)).length;
  let result = latestBand ? formatBand(latestBand.overall_band_score) : null;
  if (pending) result = result ? `${result} · ${pending} bài đang chấm` : 'Đang chấm';
  return {
    done: sent.length ? `${sent.length} bài đã nộp` : 'Chưa nộp bài nào',
    result: result ?? (sent.length ? 'Chưa có band' : null),
  };
}

/**
 * `GET /api/listening/overview` → row facts. The count covers the listening
 * programmes only (full tests outside them are not in this API), so the words
 * say so. A partial read with no programme is a failure, not "nothing done".
 */
export function listeningRow(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.programmes)) return null;
  if (raw.partial_data === true && raw.programmes.length === 0) return null;
  const done = raw.programmes.reduce((sum, p) => sum + count(p?.completed_form_count), 0);
  const recent = Array.isArray(raw.recent) ? raw.recent : [];
  const latest = recent.find((r) => r && count(r.checked_count) > 0);
  const facts = {
    done: done ? `${done} bài trong lộ trình nghe` : 'Chưa làm bài nào trong lộ trình nghe',
    result: latest ? `Đúng ${count(latest.correct_count)} trên ${count(latest.checked_count)} câu` : null,
  };
  // Some programmes could not be read: say the numbers may be short.
  return raw.partial_data === true ? { ...facts, warning: 'Một phần số liệu Listening chưa tải được, số trên có thể thiếu.' } : facts;
}

/** `GET /api/quiz/progress?skill_area=vocab` → row facts. */
export function vocabRow(raw) {
  if (!raw || typeof raw !== 'object' || !raw.totals || typeof raw.totals !== 'object') return null;
  const done = count(raw.totals.sessions);
  const sessions = Array.isArray(raw.recent_sessions) ? raw.recent_sessions : [];
  const latest = sessions.find((s) => s && count(s.total_questions) > 0);
  return {
    done: done ? `${done} lượt luyện` : 'Chưa luyện lượt nào',
    result: latest ? `Đúng ${count(latest.total_correct)} trên ${count(latest.total_questions)} câu` : null,
  };
}

/** Saved goal from `/auth/me`, as the form's string values. */
export function goalFromMe(me) {
  const band = typeof me?.target_band === 'number' && Number.isFinite(me.target_band) ? me.target_band.toFixed(1) : '';
  const examDate = typeof me?.exam_date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(me.exam_date) ? me.exam_date.slice(0, 10) : '';
  return { band, examDate };
}

/** True when a PATCH failed because the `profile_update` kill switch is off. */
export function isFeatureDisabled(error) {
  const detail = error && typeof error === 'object' ? error.detail : null;
  return (
    !!error && typeof error === 'object' && error.status === 503
    && !!detail && typeof detail === 'object' && detail.error_code === 'feature_disabled'
  );
}

/** True when a read hit FR-087's 410 `content_expired`. */
export function isContentExpired(error) {
  if (!error || typeof error !== 'object' || error.status !== 410) return false;
  const detail = error.detail;
  const code = typeof detail === 'string' ? detail : detail && typeof detail === 'object' ? detail.error_code ?? detail.code : error.code;
  return code === 'content_expired';
}
