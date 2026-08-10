const LEGACY_CHAIN_KEY = 'ielts_ft_session_ids';
const STATE_KEY = 'ielts_ft_state_v2';
const ACCEPTED_SESSION_STATUSES = new Set(['submitted', 'completed', 'analysis_failed']);
const DEFAULT_SUBMISSION_SETTLE_MS = 180_000;
const DEFAULT_FINALIZE_SETTLE_MS = 30_000;
let controllerSequence = 0;

export class SpeakingFullTestError extends Error {
  constructor(code, message, context = {}) {
    super(message, context.cause ? { cause: context.cause } : undefined);
    this.name = 'SpeakingFullTestError';
    this.code = code;
    this.cause_detail = context.cause || null;
    this.failures = context.failures || [];
  }
}

function cleanId(value) {
  return String(value == null ? '' : value).trim();
}

function uniqueIds(values) {
  const seen = new Set();
  const result = [];
  for (const value of Array.isArray(values) ? values : []) {
    const id = cleanId(value);
    if (id && !seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
}

function sameIds(left, right) {
  const a = uniqueIds(left);
  const b = uniqueIds(right);
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function responseQuestionIds(responses) {
  return uniqueIds((Array.isArray(responses) ? responses : []).map((row) => (
    row && row.id ? row.question_id : null
  )));
}

function safeParse(raw) {
  try { return JSON.parse(raw || 'null'); } catch { return null; }
}

function defaultStorage() {
  try { return globalThis.sessionStorage || null; } catch { return null; }
}

function definitiveFinalizeStatus(error) {
  const status = error?.status != null ? Number(error.status) : null;
  return new Set([400, 401, 403, 404, 409, 413, 415, 422]).has(status)
    ? status
    : null;
}

function acceptedFinalizePayload(payload, sessionIds) {
  if (!payload || payload.accepted !== true) return false;
  const returned = uniqueIds(payload.session_ids);
  return sessionIds.every((id) => returned.includes(id));
}

export class SpeakingFullTestController {
  constructor(environment = {}) {
    this.storage = Object.prototype.hasOwnProperty.call(environment, 'storage')
      ? environment.storage
      : defaultStorage();
    this.submit = environment.submit;
    this.finalize = environment.finalize;
    this.getSession = environment.getSession;
    this.submissionSettleMs = Number.isFinite(environment.submissionSettleMs)
      ? Math.max(1, environment.submissionSettleMs)
      : DEFAULT_SUBMISSION_SETTLE_MS;
    this.finalizeSettleMs = Number.isFinite(environment.finalizeSettleMs)
      ? Math.max(1, environment.finalizeSettleMs)
      : DEFAULT_FINALIZE_SETTLE_MS;
    // Browser timer functions require Window as their receiver. Keeping the
    // raw function and later calling `this.setTimer(...)` binds the controller
    // as `this`, which Chrome rejects with "Illegal invocation" exactly when
    // the first real upload/finalize reaches its settle deadline wrapper.
    this.setTimer = environment.setTimer || globalThis.setTimeout?.bind(globalThis);
    this.clearTimer = environment.clearTimer || globalThis.clearTimeout?.bind(globalThis);
    this.ownerId = null;
    this.controllerId = cleanId(environment.controllerId)
      || `speaking-full-test-${Date.now()}-${++controllerSequence}`;
    this.sessionIds = [];
    this.confirmed = new Map();
    this.pending = new Map();
    this.retryable = new Map();
    this.finalizing = null;
    this.disposed = false;
  }

  restore({
    ownerId,
    currentSessionId,
    responses = [],
    responseLookupFailed = false,
  } = {}) {
    const owner = cleanId(ownerId);
    const current = cleanId(currentSessionId);
    if (!current) {
      throw new SpeakingFullTestError(
        'invalid_state',
        'Thiếu session hiện tại để khôi phục Full Test.',
      );
    }

    this.ownerId = owner || null;
    const persisted = this.#readState();
    const ownerMatches = persisted
      && !!owner
      && (!persisted.owner_id || persisted.owner_id === owner);
    const persistedIds = ownerMatches ? uniqueIds(persisted.session_ids) : [];
    // A legacy-only install has no owner metadata, so keep its migration path.
    // Once v2 state exists and explicitly belongs to another account, however,
    // the unscoped legacy mirror must not be used as a fallback chain. Auth is
    // also required before adopting an ownerless legacy key from a shared tab.
    const legacyIds = owner && (!persisted || ownerMatches)
      ? uniqueIds(safeParse(this.#get(LEGACY_CHAIN_KEY)))
      : [];
    const candidate = persistedIds.includes(current)
      ? persistedIds
      : (legacyIds.includes(current) ? legacyIds : [current]);
    this.sessionIds = candidate.slice(0, candidate.indexOf(current) + 1);

    this.confirmed.clear();
    if (ownerMatches && persisted.confirmed && typeof persisted.confirmed === 'object') {
      for (const sid of this.sessionIds) {
        const questionIds = uniqueIds(persisted.confirmed[sid]);
        if (questionIds.length) this.confirmed.set(sid, new Set(questionIds));
      }
    }
    // An empty response list is authoritative only when its lookup succeeded.
    // Preserve the local resume ledger on an indeterminate backend read.
    if (responseLookupFailed !== true) this.confirmCanonical(current, responses);
    this.#persist(true);
    return this.getSnapshot();
  }

  replaceChain(sessionIds) {
    const ids = uniqueIds(sessionIds);
    if (!ids.length) {
      throw new SpeakingFullTestError('invalid_state', 'Full Test chưa có session nào.');
    }
    this.sessionIds = ids;
    for (const sid of Array.from(this.confirmed.keys())) {
      if (!ids.includes(sid)) this.confirmed.delete(sid);
    }
    this.#persist();
    return ids.slice();
  }

  replaceChainIfCurrent(expectedSessionIds, sessionIds) {
    const expected = uniqueIds(expectedSessionIds);
    const ids = uniqueIds(sessionIds);
    if (!this.ownerId || !expected.length || !ids.length) return false;

    // A session-creation request can settle after its route unmounts. Only let
    // that old controller extend shared storage while the persisted chain is
    // still exactly the chain it started from. A newer Full Test wins.
    const persisted = this.#readState();
    if (
      !persisted
      || persisted.owner_id !== this.ownerId
      || persisted.controller_id !== this.controllerId
      || !sameIds(persisted.session_ids, expected)
    ) return false;

    this.sessionIds = ids;
    this.confirmed.clear();
    if (persisted.confirmed && typeof persisted.confirmed === 'object') {
      for (const sid of ids) {
        const questionIds = uniqueIds(persisted.confirmed[sid]);
        if (questionIds.length) this.confirmed.set(sid, new Set(questionIds));
      }
    }
    this.#writeState(this.controllerId);
    return true;
  }

  confirmCanonical(sessionId, responses) {
    const sid = cleanId(sessionId);
    if (!sid) return;
    const ids = responseQuestionIds(responses);
    // The session payload is canonical truth for the current part, including
    // the empty case. Keeping locally-confirmed ids that are absent from this
    // readback can skip an answer after a failed/partial persistence attempt:
    // sessionStorage is only a resume cache, never proof that a response row
    // exists. Sealed sittings remain safe because their read contract returns
    // response_receipts for every persisted answer.
    if (ids.length) this.confirmed.set(sid, new Set(ids));
    else this.confirmed.delete(sid);
    this.#persist();
  }

  confirmedQuestionIds(sessionId) {
    return Array.from(this.confirmed.get(cleanId(sessionId)) || []);
  }

  submitAnswer({ sessionId, questionId, blob, priorResponseId = null } = {}) {
    if (this.disposed) {
      return Promise.reject(new SpeakingFullTestError(
        'disposed',
        'Trang Full Test đã đóng. Hãy mở lại bài thi.',
      ));
    }
    if (this.finalizing) {
      return Promise.reject(new SpeakingFullTestError(
        'finalizing',
        'Full Test đang được chốt. Không thể gửi thêm bản ghi.',
      ));
    }
    const sid = cleanId(sessionId);
    const qid = cleanId(questionId);
    if (!sid || !qid || !blob || typeof this.submit !== 'function') {
      return Promise.reject(new SpeakingFullTestError(
        'invalid_submission',
        'Thiếu dữ liệu bản ghi Full Test. Hãy ghi âm lại câu này.',
      ));
    }

    const key = `${sid}\u0000${qid}`;
    const existing = this.pending.get(key);
    if (existing && existing.blob === blob) return existing.promise;

    const item = { sessionId: sid, questionId: qid, blob, priorResponseId };
    const run = () => Promise.resolve()
      .then(() => this.#settleWithin(
        this.submit(item),
        this.submissionSettleMs,
        () => new SpeakingFullTestError(
          'submission_timeout',
          'Bản ghi vẫn đang chờ máy chủ xác nhận. Hãy thử gửi lại.',
        ),
      ))
      .then((result) => {
        const set = this.confirmed.get(sid) || new Set();
        set.add(qid);
        this.confirmed.set(sid, set);
        this.retryable.delete(key);
        this.#persist();
        return result;
      })
      .catch((error) => {
        this.retryable.set(key, { ...item, error });
        throw error;
      });
    // A duplicate caller for the same Blob shares one mutation. A genuinely
    // newer take must run after the current request, never inherit its result.
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

  async retryFailed() {
    const items = Array.from(this.retryable.values());
    if (!items.length) return this.getSnapshot();
    const settled = await Promise.allSettled(items.map((item) => this.submitAnswer(item)));
    const failures = settled.filter((result) => result.status === 'rejected');
    if (failures.length) {
      throw new SpeakingFullTestError(
        'answers_pending',
        'Một số bản ghi vẫn chưa gửi được.',
        { failures: this.#failureSnapshot() },
      );
    }
    return this.getSnapshot();
  }

  finalizeFullTest() {
    if (this.finalizing) return this.finalizing;
    const operation = this.#finalizeOnce();
    this.finalizing = operation;
    void operation.finally(() => {
      if (this.finalizing === operation) this.finalizing = null;
    }).catch(() => {});
    return operation;
  }

  async #finalizeOnce() {
    // Drain until stable rather than awaiting one snapshot. A submission that
    // was already admitted before finalize started must settle too.
    while (this.pending.size) {
      const pending = Array.from(this.pending.values(), (entry) => entry.promise);
      await Promise.allSettled(pending);
    }
    if (this.retryable.size) {
      throw new SpeakingFullTestError(
        'answers_pending',
        'Còn bản ghi chưa gửi được. Hãy gửi lại trước khi chốt bài.',
        { failures: this.#failureSnapshot() },
      );
    }
    if (this.sessionIds.length !== 3) {
      throw new SpeakingFullTestError(
        'incomplete_chain',
        'Full Test chưa đủ ba phần nên chưa thể chốt bài.',
      );
    }
    if (typeof this.finalize !== 'function') {
      throw new SpeakingFullTestError(
        'runtime_unavailable',
        'Không thể chốt Full Test. Hãy tải lại trang.',
      );
    }

    const body = { p1_id: this.sessionIds[0] };
    if (this.sessionIds[1]) body.p2_id = this.sessionIds[1];
    if (this.sessionIds[2]) body.p3_id = this.sessionIds[2];

    try {
      const payload = await this.#settleWithin(
        this.finalize(body),
        this.finalizeSettleMs,
        () => new SpeakingFullTestError(
          'ambiguous_finalize',
          'Máy chủ chưa xác nhận yêu cầu chốt bài trong thời gian dự kiến.',
        ),
      );
      if (!acceptedFinalizePayload(payload, this.sessionIds)) {
        throw new SpeakingFullTestError(
          'ambiguous_finalize',
          'Máy chủ chưa xác nhận đã nhận yêu cầu chốt bài.',
        );
      }
      this.clear();
      return payload;
    } catch (error) {
      const rejectedStatus = definitiveFinalizeStatus(error);
      if (rejectedStatus) {
        const code = rejectedStatus === 401
          ? 'auth_required'
          : (rejectedStatus === 403 ? 'finalize_forbidden' : 'finalize_rejected');
        throw new SpeakingFullTestError(
          code,
          error?.message || 'Máy chủ từ chối chốt Full Test. Hãy kiểm tra bài thi.',
          { cause: error },
        );
      }
      if (await this.#reconcileFinalize()) {
        const result = {
          accepted: true,
          session_ids: this.sessionIds.slice(),
          _reconciled: true,
        };
        this.clear();
        return result;
      }
      if (error instanceof SpeakingFullTestError) throw error;
      throw new SpeakingFullTestError(
        'ambiguous_finalize',
        'Chưa thể xác nhận Full Test đã được chốt. Hãy thử lại.',
        { cause: error },
      );
    }
  }

  async #reconcileFinalize() {
    if (typeof this.getSession !== 'function') return false;
    try {
      const sessions = await Promise.all(this.sessionIds.map((id) => this.getSession(id)));
      return sessions.every((session) => (
        session && ACCEPTED_SESSION_STATUSES.has(cleanId(session.status))
      ));
    } catch {
      return false;
    }
  }

  hasUnsavedAudio() {
    return this.pending.size > 0 || this.retryable.size > 0;
  }

  getSnapshot() {
    return {
      sessionIds: this.sessionIds.slice(),
      confirmed: Object.fromEntries(Array.from(this.confirmed, ([sid, ids]) => (
        [sid, Array.from(ids)]
      ))),
      pendingCount: this.pending.size,
      retryCount: this.retryable.size,
      failures: this.#failureSnapshot(),
      finalizing: !!this.finalizing,
    };
  }

  clear() {
    const persisted = this.#readState();
    const persistedOwner = cleanId(persisted?.owner_id);
    const ownsPersisted = !!persisted
      && sameIds(persisted.session_ids, this.sessionIds)
      && (!persistedOwner || persistedOwner === this.ownerId);
    const legacyIds = uniqueIds(safeParse(this.#get(LEGACY_CHAIN_KEY)));
    const ownsLegacy = sameIds(legacyIds, this.sessionIds);
    if (ownsPersisted) this.#remove(STATE_KEY);
    if (ownsLegacy) this.#remove(LEGACY_CHAIN_KEY);
    return ownsPersisted || ownsLegacy;
  }

  destroy() {
    this.disposed = true;
    // Fetches are deliberately not aborted: a cancelled mutation can still
    // commit on the server. Their promises settle and release themselves.
  }

  #failureSnapshot() {
    return Array.from(this.retryable.values(), (item) => ({
      sessionId: item.sessionId,
      questionId: item.questionId,
      code: item.error?.code || 'submission_failed',
    }));
  }

  #settleWithin(operation, milliseconds, timeoutError) {
    if (typeof this.setTimer !== 'function' || typeof this.clearTimer !== 'function') {
      return Promise.resolve(operation);
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = this.setTimer(() => {
        if (settled) return;
        settled = true;
        reject(timeoutError());
      }, milliseconds);
      Promise.resolve(operation).then(
        (value) => {
          if (settled) return;
          settled = true;
          this.clearTimer(timer);
          resolve(value);
        },
        (error) => {
          if (settled) return;
          settled = true;
          this.clearTimer(timer);
          reject(error);
        },
      );
    });
  }

  #readState() {
    const parsed = safeParse(this.#get(STATE_KEY));
    return parsed && parsed.version === 2 ? parsed : null;
  }

  #persist(force = false) {
    if (!this.sessionIds.length) return;
    const current = this.#readState();
    if (
      !force
      && current?.controller_id
      && current.controller_id !== this.controllerId
    ) return false;
    this.#writeState(this.controllerId);
    return true;
  }

  #writeState(controllerId) {
    const confirmed = Object.fromEntries(Array.from(this.confirmed, ([sid, ids]) => (
      [sid, Array.from(ids)]
    )));
    this.#set(LEGACY_CHAIN_KEY, JSON.stringify(this.sessionIds));
    this.#set(STATE_KEY, JSON.stringify({
      version: 2,
      owner_id: this.ownerId,
      controller_id: controllerId,
      session_ids: this.sessionIds,
      confirmed,
    }));
  }

  #get(key) {
    try { return this.storage?.getItem?.(key) ?? null; } catch { return null; }
  }

  #set(key, value) {
    try { this.storage?.setItem?.(key, value); } catch { /* storage is best-effort */ }
  }

  #remove(key) {
    try { this.storage?.removeItem?.(key); } catch { /* storage is best-effort */ }
  }
}
