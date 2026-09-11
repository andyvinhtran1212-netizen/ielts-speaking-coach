// Tab/account-scoped retry state, not analytics or proof of learner exposure.
// Persist BEFORE POST; retain exact prepared questions/random topics on retry.
// Only an acknowledged create + custom-question save clears the pending intent.
const PREFIX = 'aver:speaking-start:v1:';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const storageError = cause => new Error(['QuotaExceededError', 'NS_ERROR_DOM_QUOTA_REACHED'].includes(cause?.name)
  ? 'Bộ nhớ tab không đủ để lưu lần gửi lại. Hãy rút ngắn câu hỏi hoặc giải phóng bộ nhớ trang rồi thử lại.'
  : 'Không thể lưu mã tạo lượt trong tab này. Hãy kiểm tra quyền lưu trữ của trình duyệt rồi thử lại.');
const accountError = () => new Error('Phiên đăng nhập đã thay đổi. Vui lòng tải lại trang trước khi bắt đầu.');
const recoveryError = message => Object.assign(new Error(message
  + ' Hãy kiểm tra lịch sử luyện tập trước khi bỏ mã gửi lại; lượt cũ có thể đã được tạo.'), { canDiscardStart: true });

export function speakingStartId(crypto = globalThis.crypto) {
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes); // Safari 15: secure UUID without Math.random.
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function preparedPayload(value) {
  const body = value?.body;
  if (!body || !['practice', 'test_part', 'test_full'].includes(body.mode)
      || ![1, 2, 3].includes(body.part) || typeof body.topic !== 'string' || !body.topic.trim()) {
    throw new Error('Thông tin tạo lượt chưa hợp lệ. Vui lòng kiểm tra lại.');
  }
  if (value.questions !== undefined && (!Array.isArray(value.questions) || !value.questions.length)) {
    throw new Error('Không tìm thấy câu hỏi hợp lệ.');
  }
  const questions = value.questions?.map(question => {
    if (typeof question === 'string' && question.trim()) return question;
    if (question?.type !== 'cue_card' || typeof question.prompt !== 'string' || !question.prompt.trim()
        || (question.topic !== undefined && typeof question.topic !== 'string')
        || (question.bullets !== undefined && (!Array.isArray(question.bullets)
          || question.bullets.some(bullet => typeof bullet !== 'string')))) {
      throw new Error('Không tìm thấy câu hỏi hợp lệ.');
    }
    return { type: 'cue_card', prompt: question.prompt, topic: question.topic ?? '', bullets: [...(question.bullets ?? [])] };
  });
  // Do not persist arbitrary caller fields (especially auth/session objects).
  return {
    body: { mode: body.mode, part: body.part, topic: body.topic.trim() },
    ...(questions === undefined ? {} : { questions }),
    ...(typeof value.nextPartTopic === 'string' ? { nextPartTopic: value.nextPartTopic } : {}),
  };
}

export function clearSpeakingStartIntents(storage, keepAccountId) {
  try {
    const keys = [];
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key?.startsWith(PREFIX) && !(keepAccountId && key.startsWith(PREFIX + keepAccountId + ':'))) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch { /* Never obstruct logout because browser storage is unavailable. */ }
}

export function createSpeakingStartController({ getAccountId, getStorage, post, mintId = speakingStartId, timeoutMs = 15000 }) {
  const pending = new Map();
  const controllers = new Set();
  let disposed = false;
  async function assertAccount(accountId) {
    if (disposed || await getAccountId() !== accountId || disposed) throw accountError();
  }
  async function send(path, body, accountId) {
    await assertAccount(accountId);
    const controller = new AbortController();
    controllers.add(controller);
    let timer;
    try {
      const result = await Promise.race([
        post(path, body, accountId, controller.signal),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error('Chưa nhận được xác nhận lưu lượt. Bấm lại để gửi tiếp cùng lượt, không tạo lượt mới.'));
            controller.abort();
          }, timeoutMs);
        }),
      ]);
      await assertAccount(accountId);
      return result;
    } finally {
      clearTimeout(timer);
      controllers.delete(controller);
    }
  }
  async function execute(accountId, slot, intentKey, prepare) {
    await assertAccount(accountId);
    let storage, saved, raw;
    const key = PREFIX + accountId + ':' + slot;
    try {
      storage = getStorage();
      raw = storage.getItem(key);
    } catch (error) { throw storageError(error); }
    try {
      saved = raw ? JSON.parse(raw) : null;
      if (raw !== null && (saved?.version !== 1 || saved.accountId !== accountId || saved.slot !== slot
          || !UUID.test(saved.requestId) || typeof saved.intentKey !== 'string')) throw storageError();
      if (saved) preparedPayload(saved.prepared);
    } catch { throw recoveryError('Dữ liệu gửi lại trong tab này không còn hợp lệ.'); }

    let receipt = saved?.intentKey === intentKey ? saved : null;
    if (!receipt) {
      const prepared = preparedPayload(await prepare());
      await assertAccount(accountId);
      const requestId = mintId();
      if (!UUID.test(requestId)) throw storageError();
      receipt = { version: 1, accountId, slot, intentKey, requestId, prepared };
    }
    const prepared = preparedPayload(receipt.prepared);
    // Atomic storage failure must precede every write, including a retry. A
    // cloned/changed tab value may not silently overwrite another pending run.
    const serialized = JSON.stringify(receipt);
    try {
      if (storage.getItem(key) !== raw) throw storageError();
      storage.setItem(key, serialized);
      if (storage.getItem(key) !== serialized) throw storageError();
    } catch (error) { throw storageError(error); }
    const session = await send('/sessions', { ...prepared.body, client_session_id: receipt.requestId }, accountId);
    const sessionId = session?.session_id || session?.id;
    if (sessionId !== receipt.requestId || (session?.id && session.id !== sessionId)) {
      throw new Error('Server không trả về session hợp lệ. Chưa xác nhận được đúng lượt vừa tạo. Vui lòng thử lại.');
    }
    if (prepared.questions) {
      await send(`/sessions/${encodeURIComponent(sessionId)}/questions/custom`, { questions: prepared.questions }, accountId);
    }
    await assertAccount(accountId);
    try {
      if (storage.getItem(key) === serialized) storage.removeItem(key);
    } catch { /* Server acknowledged the complete write; cleanup cannot block entry.
               A leftover receipt only replays this known session, never a new UUID. */ }
    return { sessionId, nextPartTopic: prepared.nextPartTopic };
  }
  return {
    async start({ slot, intent, prepare }) {
      const accountId = await getAccountId();
      if (disposed || !UUID.test(accountId || '') || !['topic', 'custom', 'full'].includes(slot)) throw accountError();
      const intentKey = JSON.stringify(intent);
      if (typeof intentKey !== 'string') throw new Error('Thiếu thông tin thao tác tạo lượt.');
      const key = accountId + ':' + slot;
      const active = pending.get(key);
      if (active) {
        if (active.intentKey !== intentKey) throw new Error('Một lượt đang được chuẩn bị. Vui lòng chờ trước khi đổi nội dung.');
        return active.promise;
      }
      const promise = execute(accountId, slot, intentKey, prepare).catch(error => {
        if (error?.status === 410) throw recoveryError('Lượt cũ không còn được tiếp tục.');
        throw error;
      });
      pending.set(key, { intentKey, promise });
      try { return await promise; }
      finally { if (pending.get(key)?.promise === promise) pending.delete(key); }
    },
    async discard(slot) {
      const accountId = await getAccountId();
      await assertAccount(accountId);
      if (!UUID.test(accountId || '') || !['topic', 'custom', 'full'].includes(slot)) throw accountError();
      if (pending.has(accountId + ':' + slot)) throw new Error('Vui lòng chờ thao tác đang gửi kết thúc.');
      try {
        const storage = getStorage();
        const key = PREFIX + accountId + ':' + slot;
        storage.removeItem(key);
        if (storage.getItem(key) !== null) throw storageError();
      } catch { throw storageError(); }
    },
    dispose() {
      disposed = true;
      for (const controller of controllers) controller.abort();
    },
  };
}
