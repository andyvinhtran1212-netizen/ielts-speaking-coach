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

// Match the existing Full Test wait budget; readback needs a shorter deadline
// so a failed upload cannot move the same infinite wait into GET /sessions.
const SUBMISSION_TIMEOUT_MS = 180_000;
const READBACK_TIMEOUT_MS = 15_000;

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
    this.ref = context.ref ?? null;
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
    ref: error?.ref ?? null,
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
  if (!session) return null;
  const rows = [
    ...(Array.isArray(session.responses) ? session.responses : []),
    ...(Array.isArray(session.response_receipts) ? session.response_receipts : []),
  ];
  const wanted = String(questionId);
  return rows.find((row) => (
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

  if (context.status === 401) {
    return new SpeakingSubmissionError(
      'auth_required',
      'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại ở tab khác rồi gửi lại bản ghi.',
      context,
    );
  }
  if (context.status === 403) {
    return new SpeakingSubmissionError(
      'submission_forbidden',
      'Tài khoản hiện tại không có quyền gửi vào phiên này. Hãy đăng nhập đúng tài khoản.',
      context,
    );
  }
  if (context.status === 404) {
    return new SpeakingSubmissionError(
      'session_unavailable',
      'Phiên học này đã kết thúc hoặc không còn tồn tại. Hãy mở lại phiên học.',
      context,
    );
  }

  // A concrete 4xx response means the server rejected this request before it
  // could be accepted. Network errors, malformed 2xx responses and 5xx errors
  // are ambiguous: the response row may already be canonical.
  const definitelyRejected = new Set([400, 413, 415, 422]);
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
    this.submissionTimeoutMs = environment.submissionTimeoutMs ?? SUBMISSION_TIMEOUT_MS;
    this.readbackTimeoutMs = environment.readbackTimeoutMs ?? READBACK_TIMEOUT_MS;
    this.pending = new Map();
    this.unconfirmed = new Map();
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
    if (existing && existing.blob === blob) return existing.promise;

    const submission = {
      sessionId: sid,
      questionId: qid,
      blob,
      filename: String(filename || '').trim() || speakingAudioFilename(blob),
      priorResponseId: String(priorResponseId == null ? '' : priorResponseId).trim() || null,
    };
    const run = () => this.#submitOnce(submission);
    // Same question + same blob is one idempotent caller. A genuinely new take
    // must never alias the old promise: serialize it so the canonical upsert's
    // last take wins and no recording is silently discarded.
    const operation = existing
      ? existing.promise.then(run, run)
      : run();
    const entry = { blob, promise: operation };
    this.pending.set(key, entry);
    void operation.finally(() => {
      if (this.pending.get(key) === entry) this.pending.delete(key);
    }).catch(() => {});
    return operation;
  }

  async #submitOnce({ sessionId, questionId, blob, filename, priorResponseId }) {
    const key = `${sessionId}\u0000${questionId}`;
    const previous = this.unconfirmed.get(key);
    if (previous) {
      // A retry first checks the old request. It may have committed after the
      // browser stopped waiting. A failed read is never permission to reupload.
      let recovered = previous.blob === blob ? previous.receipt : null;
      if (!recovered) {
        try {
          const readback = await this.#readback(sessionId, questionId, previous.priorResponseId);
          if (previous.blob === blob) recovered = readback;
        } catch {
          throw previous.error;
        }
      }
      if (recovered) {
        this.unconfirmed.delete(key);
        return recovered;
      }
      // Even a transport which ignores AbortSignal must not run two uploads
      // for this question at once. Keep the recording and allow another check.
      if (!previous.settled) throw previous.error;
    }
    if (this.disposed) {
      throw new SpeakingSubmissionError('disposed', 'Trang làm bài đã đóng. Hãy mở lại phiên học.');
    }
    const formData = new this.FormDataCtor();
    formData.append('question_id', questionId);
    formData.append('audio_file', blob, filename);

    const attempt = { blob, priorResponseId, settled: false, receipt: null, error: null };
    this.unconfirmed.set(key, attempt);
    let direct;
    try {
      direct = await this.#requestWithin(
        (signal) => {
          let request;
          try {
            request = Promise.resolve(this.upload(
              `/sessions/${encodeURIComponent(sessionId)}/responses`,
              formData,
              { signal },
            ));
          } catch (error) {
            attempt.settled = true;
            throw error;
          }
          // Observe late settlement without allowing it to update the player.
          void request.then((result) => {
            attempt.settled = true;
            if (responseId(result)) attempt.receipt = result;
          }, () => { attempt.settled = true; });
          return request;
        },
        this.submissionTimeoutMs,
        { sessionId, questionId },
      );
    } catch (error) {
      const classified = classifySubmissionError(error, sessionId, questionId);
      if (classified.code !== 'ambiguous_commit') {
        this.unconfirmed.delete(key);
        throw classified;
      }
      attempt.error = classified;
      const recovered = await this.#reconcile(classified, sessionId, questionId, priorResponseId);
      this.unconfirmed.delete(key);
      return recovered;
    }

    if (responseId(direct)) {
      this.unconfirmed.delete(key);
      return direct;
    }

    // A 2xx/empty or 2xx/malformed payload is not proof of persistence. Older
    // backend versions had exactly this silent-success failure mode.
    const malformed = new SpeakingSubmissionError(
      'ambiguous_commit',
      'Máy chủ phản hồi nhưng chưa xác nhận mã bản ghi.',
      { sessionId, questionId },
    );
    attempt.error = malformed;
    const recovered = await this.#reconcile(malformed, sessionId, questionId, priorResponseId);
    this.unconfirmed.delete(key);
    return recovered;
  }

  async #requestWithin(request, milliseconds, context) {
    const controller = new AbortController();
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new SpeakingSubmissionError(
          'ambiguous_commit',
          'Chờ máy chủ quá lâu. Chưa thể xác nhận bản ghi đã được lưu.',
          context,
        ));
        controller.abort();
      }, milliseconds);
    });
    try {
      return await Promise.race([request(controller.signal), deadline]);
    } finally {
      clearTimeout(timer);
    }
  }

  async #readback(sessionId, questionId, priorResponseId) {
    const session = await this.#requestWithin(
      (signal) => this.getSession(`/sessions/${encodeURIComponent(sessionId)}`, { signal }),
      this.readbackTimeoutMs,
      { sessionId, questionId },
    );
    const row = findPersistedSpeakingResponse(session, questionId);
    // The row that existed before a retake does not prove the new audio saved.
    if (row && (!priorResponseId || String(row.id) !== priorResponseId)) {
      return {
        response_id: row.id,
        _reconciled: true,
        _persisted_response: row,
      };
    }
    return null;
  }

  async #reconcile(originalError, sessionId, questionId, priorResponseId) {
    try {
      const recovered = await this.#readback(sessionId, questionId, priorResponseId);
      if (recovered) return recovered;
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
