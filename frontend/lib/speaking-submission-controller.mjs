const AUDIO_EXTENSIONS = Object.freeze({
  'audio/flac': 'flac',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/wave': 'wav',
  'audio/webm': 'webm',
  'audio/x-m4a': 'm4a',
});

export function speakingAudioFilename(blob) {
  const mime = String(blob?.type || '').split(';', 1)[0].trim().toLowerCase();
  return `response.${AUDIO_EXTENSIONS[mime] || 'webm'}`;
}

export class SpeakingSubmissionError extends Error {
  constructor(code, message, context = {}) {
    super(message, context.cause ? { cause: context.cause } : undefined);
    this.name = 'SpeakingSubmissionError';
    this.code = code;
    this.status = context.status ?? null;
    this.detail = context.detail ?? null;
    this.request_id = context.requestId ?? null;
    this.session_id = context.sessionId ?? null;
    this.question_id = context.questionId ?? null;
  }
}

function requiredId(value, field) {
  const id = String(value == null ? '' : value).trim();
  if (!id) {
    throw new SpeakingSubmissionError(
      'invalid_submission',
      `Thiếu ${field} để gửi bản ghi. Hãy tải lại trang.`,
    );
  }
  return id;
}

function errorContext(error, sessionId, questionId) {
  return {
    cause: error,
    status: error?.status != null && Number.isFinite(Number(error.status))
      ? Number(error.status)
      : null,
    detail: error?.detail ?? null,
    requestId: error?.request_id ?? null,
    sessionId,
    questionId,
  };
}

function responseId(data) {
  if (!data || typeof data !== 'object') return null;
  const id = String(data.response_id == null ? '' : data.response_id).trim();
  return id || null;
}

export function findPersistedSpeakingResponse(session, questionId) {
  if (!session || !Array.isArray(session.responses)) return null;
  const wanted = String(questionId);
  return session.responses.find((row) => (
    row
    && String(row.question_id == null ? '' : row.question_id) === wanted
    && String(row.id == null ? '' : row.id).trim()
  )) || null;
}

function classifySubmissionError(error, sessionId, questionId) {
  const context = errorContext(error, sessionId, questionId);
  const detail = context.detail;

  if (detail && detail.code === 'audio_too_short') {
    return new SpeakingSubmissionError(
      'audio_too_short',
      detail.message || 'Bản ghi quá ngắn. Hãy ghi lại với câu trả lời dài hơn.',
      context,
    );
  }

  if (
    context.status === 500
    && detail
    && detail.error_code === 'response_persist_failed'
  ) {
    return new SpeakingSubmissionError(
      'response_persist_failed',
      detail.message || 'Lỗi lưu phản hồi, vui lòng thử lại.',
      context,
    );
  }

  // A concrete 4xx response means the server rejected this request before it
  // could be accepted. Network errors, malformed 2xx responses and 5xx errors
  // are ambiguous: the response row may already be canonical.
  const definitelyRejected = new Set([400, 401, 403, 404, 413, 415, 422]);
  if (definitelyRejected.has(context.status)) {
    return new SpeakingSubmissionError(
      'submission_rejected',
      'Máy chủ chưa nhận bản ghi này. Hãy kiểm tra phiên học rồi thử lại.',
      context,
    );
  }

  return new SpeakingSubmissionError(
    'ambiguous_commit',
    'Chưa thể xác nhận bản ghi đã được lưu hay chưa.',
    context,
  );
}

export class SpeakingSubmissionController {
  constructor(environment = {}) {
    this.upload = environment.upload;
    this.getSession = environment.getSession;
    this.FormDataCtor = environment.FormDataCtor || globalThis.FormData;
    this.pending = new Map();
    this.disposed = false;
  }

  submit({
    sessionId,
    questionId,
    blob,
    filename = null,
    priorResponseId = null,
  } = {}) {
    if (this.disposed) {
      return Promise.reject(new SpeakingSubmissionError(
        'disposed',
        'Trang làm bài đã đóng. Hãy mở lại phiên học.',
      ));
    }

    let sid;
    let qid;
    try {
      sid = requiredId(sessionId, 'session_id');
      qid = requiredId(questionId, 'question_id');
      if (!blob) {
        throw new SpeakingSubmissionError(
          'invalid_submission',
          'Không tìm thấy bản ghi âm để gửi. Hãy ghi âm lại.',
        );
      }
      if (typeof this.upload !== 'function' || typeof this.getSession !== 'function') {
        throw new SpeakingSubmissionError(
          'runtime_unavailable',
          'Không thể kết nối bộ gửi bài. Hãy tải lại trang.',
        );
      }
      if (typeof this.FormDataCtor !== 'function') {
        throw new SpeakingSubmissionError(
          'runtime_unavailable',
          'Trình duyệt không hỗ trợ gửi bản ghi âm.',
        );
      }
    } catch (error) {
      return Promise.reject(error);
    }

    const key = `${sid}\u0000${qid}`;
    const existing = this.pending.get(key);
    if (existing) return existing;

    const operation = this.#submitOnce({
      sessionId: sid,
      questionId: qid,
      blob,
      filename: String(filename || '').trim() || speakingAudioFilename(blob),
      priorResponseId: String(priorResponseId == null ? '' : priorResponseId).trim() || null,
    });
    this.pending.set(key, operation);
    void operation.finally(() => {
      if (this.pending.get(key) === operation) this.pending.delete(key);
    }).catch(() => {});
    return operation;
  }

  async #submitOnce({ sessionId, questionId, blob, filename, priorResponseId }) {
    const formData = new this.FormDataCtor();
    formData.append('question_id', questionId);
    formData.append('audio_file', blob, filename);

    let direct;
    try {
      direct = await this.upload(
        `/sessions/${encodeURIComponent(sessionId)}/responses`,
        formData,
      );
    } catch (error) {
      const classified = classifySubmissionError(error, sessionId, questionId);
      if (classified.code !== 'ambiguous_commit') throw classified;
      return this.#reconcile(classified, sessionId, questionId, priorResponseId);
    }

    if (responseId(direct)) return direct;

    // A 2xx/empty or 2xx/malformed payload is not proof of persistence. Older
    // backend versions had exactly this silent-success failure mode.
    const malformed = new SpeakingSubmissionError(
      'ambiguous_commit',
      'Máy chủ phản hồi nhưng chưa xác nhận mã bản ghi.',
      { sessionId, questionId },
    );
    return this.#reconcile(malformed, sessionId, questionId, priorResponseId);
  }

  async #reconcile(originalError, sessionId, questionId, priorResponseId) {
    try {
      const session = await this.getSession(
        `/sessions/${encodeURIComponent(sessionId)}`,
      );
      const row = findPersistedSpeakingResponse(session, questionId);
      // Readback of the same row that existed before a retake is not proof that
      // this new audio committed. Without a backend revision/idempotency token,
      // the only safe answer is still "ambiguous" and a retry (the upsert key is
      // session_id + question_id, so retry cannot create a second response row).
      if (row && (!priorResponseId || String(row.id) !== priorResponseId)) {
        return {
          response_id: row.id,
          _reconciled: true,
          _persisted_response: row,
        };
      }
    } catch {
      // GET /sessions itself can fail. Absence of readback is never proof that
      // the mutation did not commit, so preserve the original ambiguity.
    }

    throw originalError;
  }

  destroy() {
    this.disposed = true;
    // Do not abort mutations: a cancelled fetch can still commit server-side.
    // Pending promises remove themselves when the network settles.
  }
}
