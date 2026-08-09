const BOOTSTRAP_SOURCE = 'next-native-bootstrap-v1';

export class PracticeBootstrapError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PracticeBootstrapError';
    this.code = code;
  }
}

export function createPracticeBootstrapOnce(loader) {
  if (typeof loader !== 'function') {
    throw new TypeError('practice-bootstrap-loader-required');
  }
  let promise = null;
  return function loadOnce() {
    if (!promise) promise = Promise.resolve().then(loader);
    return promise;
  };
}

export function readPracticeSessionId(search) {
  const value = new URLSearchParams(search || '').get('session_id');
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function requireApi(api) {
  if (!api || typeof api.get !== 'function' || typeof api.post !== 'function') {
    throw new PracticeBootstrapError(
      'api_unavailable',
      'Không thể kết nối dịch vụ bài luyện. Hãy tải lại trang.',
    );
  }
}

export async function loadPracticeBootstrap({ api, sessionId, userId, onPhase }) {
  requireApi(api);
  if (typeof sessionId !== 'string' || !sessionId.trim()) {
    throw new PracticeBootstrapError(
      'missing_session_id',
      'Thiếu session_id trong URL. Hãy bắt đầu phiên mới từ Dashboard.',
    );
  }

  const canonicalSessionId = sessionId.trim();
  const encodedSessionId = encodeURIComponent(canonicalSessionId);
  const phase = typeof onPhase === 'function' ? onPhase : () => {};

  phase('Đang tải session...');
  const sessionData = await api.get('/sessions/' + encodedSessionId);
  if (!sessionData || typeof sessionData !== 'object' || Array.isArray(sessionData)) {
    throw new PracticeBootstrapError(
      'invalid_session',
      'Không thể tải session. Hãy kiểm tra kết nối và thử lại.',
    );
  }
  if (sessionData.mode === 'test_full' && sessionData.response_lookup_failed === true) {
    throw new PracticeBootstrapError(
      'response_lookup_failed',
      'Không thể đọc tiến độ Full Test. Hãy tải lại trang trước khi ghi âm tiếp.',
    );
  }

  phase('Đang tải câu hỏi...');
  let questions = await api.get('/sessions/' + encodedSessionId + '/questions');
  if (questions != null && !Array.isArray(questions)) {
    throw new PracticeBootstrapError(
      'invalid_questions',
      'Dữ liệu câu hỏi không hợp lệ. Hãy tải lại trang.',
    );
  }

  if (!questions || questions.length === 0) {
    phase('Đang tạo câu hỏi với AI...');
    questions = await api.post('/sessions/' + encodedSessionId + '/questions/generate', {});
  }

  if (!Array.isArray(questions) || questions.length === 0) {
    throw new PracticeBootstrapError(
      'no_questions',
      'Không thể tạo câu hỏi. Hãy kiểm tra kết nối mạng và thử lại.',
    );
  }

  return Object.freeze({
    source: BOOTSTRAP_SOURCE,
    sessionId: canonicalSessionId,
    userId: typeof userId === 'string' && userId ? userId : null,
    sessionData,
    questions: questions.slice(),
  });
}

export function isNextPracticeBootstrap(value) {
  return !!value
    && value.source === BOOTSTRAP_SOURCE
    && typeof value.sessionId === 'string'
    && value.sessionId.length > 0
    && !!value.sessionData
    && typeof value.sessionData === 'object'
    && !Array.isArray(value.sessionData)
    && Array.isArray(value.questions)
    && value.questions.length > 0;
}
