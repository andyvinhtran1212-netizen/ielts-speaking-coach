import { createListeningSaveCoordinator } from './listening-test-controller.mjs';

const PROTOCOL = 'question-cas-v1';
const fail = (message, status) => Object.assign(new Error(message), { status });

/** Reuse the existing serial save queue; flags have separate per-question CAS. */
export function createAttemptFlagCoordinator({
  attemptId, read, write, makeOperationId = () => crypto.randomUUID(),
  debounceMs = 100, requestTimeoutMs = 15000,
  restoredPending = /** @type {unknown[]} */ ([]),
}) {
  const canonical = new Map();
  const desired = new Map();
  const operations = new Map();
  const sent = new Set();
  const listeners = new Set();
  let ready = false;
  let disposed = false;
  let readGeneration = 0;
  const assertScope = (reply) => {
    if (reply?.attempt_id !== attemptId || reply?.protocol !== PROTOCOL) {
      throw fail('Không xác nhận được cờ Review của lượt làm này.', 409);
    }
  };
  const assertRow = (row) => {
    if (!Number.isInteger(row?.q_num) || row.q_num < 1 || row.q_num > 40
        || typeof row.flagged !== 'boolean' || !Number.isSafeInteger(row.revision)
        || row.revision < 0 || typeof row.question_id !== 'string' || !row.question_id) {
      throw fail('Dữ liệu cờ Review không hợp lệ.', 503);
    }
  };
  const mergeRow = (row) => {
    assertRow(row);
    const previous = canonical.get(row.q_num);
    if (previous && previous.question_id !== row.question_id) {
      throw fail('Câu hỏi của lượt làm đã thay đổi. Tải lại bài để kiểm tra.', 409);
    }
    if (!previous || row.revision >= previous.revision) canonical.set(row.q_num, row);
  };
  const snapshot = () => ({
    ready,
    flagged: new Set([...desired].filter(([, value]) => value).map(([q]) => q)),
    canonical: new Map(canonical),
    states: queue.snapshot(),
    pending: [...queue.snapshot().keys()].map((qNum) => {
      let request = operations.get(qNum);
      if (!request || request.flagged !== desired.get(qNum)) {
        request = { q_num: qNum, flagged: desired.get(qNum), expected_revision: canonical.get(qNum)?.revision || 0, operation_id: makeOperationId() };
        operations.set(qNum, request);
      }
      return { ...request, sent: sent.has(request.operation_id) };
    }),
  });
  const notify = () => { if (!disposed) for (const listener of listeners) listener(snapshot()); };
  const queue = createListeningSaveCoordinator({
    debounceMs, requestTimeoutMs, retryDelays: [],
    save: async (qNum, value, options) => {
      const flagged = value === '1';
      const revision = canonical.get(qNum)?.revision || 0;
      let request = operations.get(qNum);
      if (!request || request.flagged !== flagged || (!sent.has(request.operation_id) && request.expected_revision !== revision)) {
        request = { q_num: qNum, flagged, expected_revision: revision, operation_id: makeOperationId() };
        operations.set(qNum, request);
      }
      sent.add(request.operation_id);
      notify();
      const reply = await write(request, options);
      if (disposed) return null;
      assertScope(reply);
      assertRow(reply);
      if (reply.q_num !== qNum || typeof reply.accepted !== 'boolean'
          || (reply.accepted && reply.operation_id !== request.operation_id)) {
        throw fail('Máy chủ chưa xác nhận đúng thay đổi cờ Review.', 409);
      }
      if (!reply.accepted) {
        mergeRow(reply);
        if (operations.get(qNum) === request) operations.delete(qNum);
        throw fail('Cờ Review đã thay đổi ở nơi khác. Kiểm tra và thử lại thay đổi của bạn.', 409);
      }
      if (reply.revision <= request.expected_revision) {
        throw fail('Phiên bản cờ Review chưa được xác nhận.', 409);
      }
      mergeRow(reply);
      if (operations.get(qNum) === request) operations.delete(qNum);
      return reply;
    },
  });
  const unsubscribe = queue.subscribe(notify);

  async function load() {
    const generation = ++readGeneration;
    const reply = await read();
    if (disposed || generation !== readGeneration) return false;
    assertScope(reply);
    if (!Array.isArray(reply.review_flags)) throw fail('Không tải được cờ Review.', 503);
    // Validate the whole response before changing any displayed state.
    reply.review_flags.forEach(assertRow);
    if (new Set(reply.review_flags.map((row) => row.q_num)).size !== reply.review_flags.length
        || reply.review_flags.some((row) => canonical.has(row.q_num)
          && canonical.get(row.q_num).question_id !== row.question_id)) {
      throw fail('Không xác nhận được danh sách cờ Review.', 409);
    }
    for (const row of reply.review_flags) {
      mergeRow(row);
      if (!queue.snapshot().has(row.q_num)) desired.set(row.q_num, canonical.get(row.q_num).flagged);
    }
    if (!ready) {
      for (const receipt of restoredPending) {
        if (!Number.isInteger(receipt?.q_num) || receipt.q_num < 1 || receipt.q_num > 40
            || typeof receipt.flagged !== 'boolean' || !Number.isSafeInteger(receipt.expected_revision)
            || receipt.expected_revision < 0 || typeof receipt.operation_id !== 'string'
            || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(receipt.operation_id)
            || typeof receipt.sent !== 'boolean') continue;
        const { q_num, flagged, expected_revision, operation_id } = receipt;
        desired.set(q_num, flagged);
        operations.set(q_num, { q_num, flagged, expected_revision, operation_id });
        if (receipt.sent) sent.add(operation_id);
      }
      queue.restoreFailed([...operations.keys()].map((q) => [q, desired.get(q) ? '1' : '']));
    }
    ready = true;
    queue.seed([...desired].map(([q, flag]) => [q, flag ? '1' : '']));
    notify();
    return true;
  }
  function update(qNum, flagged) {
    if (disposed || !ready) throw fail('Chờ tải cờ Review trước khi thay đổi.', 409);
    if (!Number.isInteger(qNum) || qNum < 1 || qNum > 40 || typeof flagged !== 'boolean') {
      throw new TypeError('Invalid review flag');
    }
    desired.set(qNum, flagged);
    queue.update(qNum, flagged ? '1' : '');
  }
  return {
    load, update, snapshot,
    flush: (options) => queue.flush(options),
    retryFailed: () => queue.retryFailed(),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    dispose() { disposed = true; readGeneration += 1; unsubscribe(); queue.dispose(); listeners.clear(); },
  };
}
