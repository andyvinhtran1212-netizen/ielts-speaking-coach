function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function labelValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return text(value);
}

export function normalizeSessionAlert(value) {
  if (!value || typeof value !== 'object') return null;
  const id = text(value.id);
  if (!id) return null;
  const errorCode = text(value.error_code);
  return {
    id,
    userId: text(value.user_id),
    userEmail: text(value.user_email),
    mode: text(value.mode),
    part: labelValue(value.part),
    topic: text(value.topic),
    errorCode,
    errorMessage: text(value.error_message),
    failedStep: text(value.failed_step),
    occurredAt: text(value.last_error_at) || text(value.started_at),
    status: text(value.status),
  };
}

export function normalizeGradingAlert(value) {
  if (!value || typeof value !== 'object') return null;
  const id = text(value.id);
  const sessionId = text(value.session_id);
  if (!id || !sessionId) return null;
  return {
    id,
    sessionId,
    questionId: text(value.question_id),
    userEmail: text(value.user_email),
    gradingStatus: text(value.grading_status),
    sttStatus: text(value.stt_status),
  };
}

export function normalizeAlertsPayload(value) {
  if (!value || typeof value !== 'object'
      || !Array.isArray(value.session_errors)
      || !Array.isArray(value.grading_failures)) return null;

  const sessionErrors = value.session_errors.map(normalizeSessionAlert).filter(Boolean);
  const gradingFailures = value.grading_failures.map(normalizeGradingAlert).filter(Boolean);
  return {
    sessionErrors,
    gradingFailures,
    malformedCount:
      value.session_errors.length - sessionErrors.length
      + value.grading_failures.length - gradingFailures.length,
  };
}

export function shortId(value) {
  const id = text(value);
  if (!id) return '—';
  return id.length > 9 ? `${id.slice(0, 8)}…` : id;
}

export function formatAlertTime(value, locale = 'vi-VN') {
  const raw = text(value);
  if (!raw) return 'Chưa rõ';
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return 'Chưa rõ';
  return parsed.toLocaleString(locale, {
    hour: '2-digit', minute: '2-digit',
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

export function sessionAlertLabel(code) {
  return ({
    stt_failed: 'Nhận dạng giọng nói',
    grading_failed: 'Chấm bài',
    save_failed: 'Lưu dữ liệu',
    pdf_failed: 'Tạo PDF',
  })[code] || code || 'Lỗi chưa phân loại';
}

export function alertsForScope(payload, scope) {
  if (!payload) return { sessionErrors: [], gradingFailures: [] };
  if (scope === 'sessions') return { sessionErrors: payload.sessionErrors, gradingFailures: [] };
  if (scope === 'grading') return { sessionErrors: [], gradingFailures: payload.gradingFailures };
  return { sessionErrors: payload.sessionErrors, gradingFailures: payload.gradingFailures };
}
