// Durable command recovery, NOT optional observation. Browser metadata is never
// authority; SQL revalidates identity/provenance on every preparation/execution.
// No window/storage access during module evaluation or server rendering.
import { speakingStartId } from './speaking-start-intent.mjs';

const PREFIX = 'aver:writing-admission:v1:';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const error = message => Object.assign(new Error(message), { writingAdmission: true });
const uncertain = () => error('Chưa xác nhận được trạng thái mở bài. Bản nháp không bị xóa; mở lại bài để kiểm tra trước khi thử lại.');
const storageError = () => error('Không thể đọc hoặc lưu mã bắt đầu trong tab này. Kiểm tra quyền lưu trữ rồi thử lại; chưa chuyển sang cách bắt đầu khác.');
const accountError = () => error('Trang hoặc phiên đăng nhập đã thay đổi. Vui lòng mở lại bài.');
const keyFor = (accountId, assignmentId) => PREFIX + accountId + ':' + assignmentId;

function receipt(raw, accountId, assignmentId) {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw);
    if (value.v !== 1 || value.accountId !== accountId || value.assignmentId !== assignmentId
        || !UUID.test(value.nonce || '') || !['pending', 'complete', 'fenced'].includes(value.state)
        || (value.commandId !== null && !UUID.test(value.commandId || ''))
        || (value.kind !== undefined && value.kind !== 'baseline')
        || (value.kind === 'baseline' && (value.commandId !== null || value.state === 'fenced'))
        || (value.state !== 'pending' && value.commandId === null && value.kind !== 'baseline')) throw Error();
    return value;
  } catch { throw storageError(); } // Never discard an ambiguous persisted intent.
}

export function clearWritingAdmissionIntents(storage, keepAccountId = /** @type {string | null} */ (null)) {
  try {
    const keys = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(PREFIX) && !(keepAccountId && key.startsWith(PREFIX + keepAccountId + ':'))) keys.push(key);
    }
    keys.forEach(key => storage.removeItem(key));
  } catch { /* Logout must still proceed; server ownership remains authoritative. */ }
}

export function shouldUseWritingAdmission({ enabled, getStorage, accountId, assignmentId }) {
  if (enabled === true) return true;
  // A rollback flag is not permission to abandon a possibly accepted command.
  // Resolve a known pending intent through status, never through legacy /start.
  let saved;
  try { saved = receipt(getStorage().getItem(keyFor(accountId, assignmentId)), accountId, assignmentId); }
  catch { throw storageError(); }
  return saved?.state === 'pending';
}

function validateTimer(value, assignmentId) {
  const timer = value?.timer;
  if (value?.assignment_id !== assignmentId || typeof value.started !== 'boolean'
      || !timer || typeof timer.is_timed !== 'boolean' || typeof timer.is_expired !== 'boolean'
      || (timer.is_timed ? !Number.isInteger(timer.time_limit_minutes) || timer.time_limit_minutes < 1
        : timer.time_limit_minutes !== null)
      || (timer.time_remaining_seconds !== null && (!Number.isFinite(timer.time_remaining_seconds) || timer.time_remaining_seconds < 0))
      || (timer.expires_at !== null && !Number.isFinite(Date.parse(timer.expires_at)))
      || typeof timer.auto_submitted !== 'boolean'
      || !['pending','in_progress','submitted','graded','delivered'].includes(timer.status)
      || (value.started !== (timer.started_at !== null))
      || (value.started && !Number.isFinite(Date.parse(timer.started_at)))) throw uncertain();
  return value;
}

function validateEntry(value, assignmentId, entered = false) {
  validateTimer(value, assignmentId);
  const terminal = ['submitted','graded','delivered'].includes(value.timer.status);
  if (!['eligible','admitted','baseline_untracked','baseline_unclaimed','terminal','blocked'].includes(value.kind)
      || (value.kind === 'terminal') !== terminal
      || (value.kind === 'eligible' && (value.started || value.timer.status !== 'pending'))
      || (value.kind === 'admitted' && !value.started)
      || (entered && value.kind !== 'terminal' && (!isBaseline(value) || !value.started))) throw uncertain();
  return value;
}
const isBaseline = value => ['baseline_untracked','baseline_unclaimed'].includes(value.kind);

function validate(value, assignmentId, commandId = null) {
  validateTimer(value, assignmentId);
  const c = value.command;
  if (!c || !UUID.test(c.command_id || '')
      || (commandId && c.command_id !== commandId) || !UUID.test(c.episode_id || '')
      || !UUID.test(c.activity_epoch_id || '') || !Number.isInteger(c.generation) || c.generation < 0
      || !['accepted','bound','unstarted_expired'].includes(c.phase)
      || ((c.phase === 'unstarted_expired') !== (c.generation > 0))
      || !Number.isFinite(Date.parse(c.execute_before))
      || (c.phase === 'bound' && !value.started)) throw uncertain();
  return value;
}

export function createWritingAdmissionController({ getAccountId, getStorage, request,
  mintId = speakingStartId, timeoutMs = 15000 }) {
  let disposed = false;
  const flights = new Map(), aborters = new Set();
  async function assertAccount(accountId) {
    try {
      if (disposed || await getAccountId() !== accountId || disposed) throw accountError();
    } catch { throw accountError(); }
  }
  async function send(accountId, method, path, body) {
    await assertAccount(accountId);
    const controller = new AbortController();
    aborters.add(controller);
    let timer;
    try {
      const value = await Promise.race([
        request(method, path, body, accountId, controller.signal),
        new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(uncertain()); }, timeoutMs); }),
      ]);
      await assertAccount(accountId);
      return value;
    } catch (cause) {
      if (cause?.writingAdmission) throw cause;
      // 409 here is not evidence of a submitted essay. No receipt/content cleanup.
      if ([401, 403].includes(cause?.status)) throw accountError();
      if ([404, 409, 410, 422].includes(cause?.status)) {
        throw Object.assign(error('Chưa thể mở lượt làm bài này. Bản nháp và mã yêu cầu được giữ nguyên; hãy kiểm tra lại trạng thái bài.'),
          { admissionStatus: cause.status }); // not `status`: not a submission ACK
      }
      throw uncertain();
    } finally {
      clearTimeout(timer);
      aborters.delete(controller);
    }
  }
  async function run(accountId, assignmentId, allowCreate) {
    if (!UUID.test(accountId || '') || !UUID.test(assignmentId || '')) throw accountError();
    await assertAccount(accountId);
    let storage, raw, saved;
    const key = keyFor(accountId, assignmentId);
    try { storage = getStorage(); raw = storage.getItem(key); saved = receipt(raw, accountId, assignmentId); }
    catch { throw storageError(); }
    const save = (next, required = true) => {
      try {
        if (disposed || storage.getItem(key) !== raw) throw storageError();
        const serialized = JSON.stringify(next);
        storage.setItem(key, serialized);
        if (storage.getItem(key) !== serialized) throw storageError();
        raw = serialized; saved = next;
      } catch { if (required) throw storageError(); }
    };
    const base = '/api/writing/my-assignments/' + encodeURIComponent(assignmentId);
    let recovered;
    if (saved && saved.commandId === null && saved.state === 'pending') {
      const lookup = await send(accountId, 'GET', base + '/admission-intents/' + encodeURIComponent(saved.nonce), null);
      if (typeof lookup?.found !== 'boolean' || (lookup.found ? !lookup.admission : lookup.admission !== null)) throw uncertain();
      if (lookup.found) {
        if (saved.kind === 'baseline') throw uncertain(); // do not relabel confirmed baseline history
        recovered = validate(lookup.admission, assignmentId);
        save({ ...saved, commandId: recovered.command.command_id }); // BEFORE any execution
      }
      // A coherent absence is only a hint. Both preparation and baseline entry
      // still revalidate the SAME nonce under locks (A may be in flight now).
    }
    // Known unresolved commands never cross protocols based on classification.
    // A read may precede intent storage, but every mutating request still needs
    // durable local intent. A stale hint is revalidated by the baseline SQL RPC.
    let entry;
    if (!saved?.commandId || (allowCreate && saved.state !== 'pending')) {
      entry = validateEntry(await send(accountId, 'GET', base + '/entry', null), assignmentId);
      if (entry.kind === 'blocked') throw error('Bài có trạng thái cần kiểm tra. Bản nháp và mã yêu cầu được giữ nguyên; chưa mở lại đồng hồ.');
      if (saved?.kind === 'baseline' && !isBaseline(entry) && entry.kind !== 'terminal') throw uncertain();
      if (isBaseline(entry) && saved?.commandId) throw uncertain();
      // With no pending intent this is an owned read, not a start/recovery write.
      if (entry.kind === 'terminal' && (!saved || saved.state !== 'pending')) return entry;
      if (isBaseline(entry) && !saved && !allowCreate) {
        if (!entry.started) throw error('Bấm Bắt đầu ở thẻ bài tập để xác nhận mở lượt làm bài.');
        return entry;
      }
    }
    const baseline = entry && (isBaseline(entry) || (entry.kind === 'terminal' && !saved?.commandId));
    if (!saved || (!baseline && allowCreate && saved.state !== 'pending')) {
      if (!allowCreate) throw error('Bấm Bắt đầu ở thẻ bài tập để xác nhận mở lượt làm bài.');
      let nonce;
      try { nonce = mintId(); } catch { throw storageError(); }
      if (!UUID.test(nonce || '')) throw storageError();
      save({ v: 1, accountId, assignmentId, nonce, commandId: null, state: 'pending' });
    }
    if (baseline) {
      // Keep an unknown A nonce unchanged. Do not mark it baseline until SQL
      // proves that no command/episode exists, including after a lost A ACK.
      save({ ...saved, state: 'pending' });
      const result = validateEntry(await send(accountId, 'POST', base + '/baseline-entry',
        { protocol: 'baseline-v1', launch_nonce: saved.nonce, allow_start: allowCreate === true }), assignmentId, true);
      await assertAccount(accountId);
      save({ ...saved, kind: 'baseline', state: 'complete' }, false);
      return result;
    }
    const admissions = base + '/admissions';
    let result = recovered || (saved.commandId
      ? validate(await send(accountId, 'GET', admissions + '/' + saved.commandId, null), assignmentId, saved.commandId)
      : validate(await send(accountId, 'POST', admissions, { protocol: 'admission-v1', launch_nonce: saved.nonce }), assignmentId));
    if (!saved.commandId) save({ ...saved, commandId: result.command.command_id }); // BEFORE B
    if (['submitted','graded','delivered'].includes(result.timer.status)) {
      // Source completion is not proof this command executed. Show canonical
      // terminal UI without executing B or inventing a successful receipt.
      save({ ...saved, state: result.command.phase === 'bound' ? 'complete'
        : result.command.phase === 'unstarted_expired' ? 'fenced' : 'pending' }, false);
      return result;
    }
    const rejectFenced = () => {
      save({ ...saved, state: 'fenced' });
      throw error('Lệnh bắt đầu cũ đã hết hạn và được khóa. Bấm Bắt đầu lại để gửi yêu cầu mới; không xóa bài đã lưu.');
    };
    if (result.command.phase === 'unstarted_expired') rejectFenced();
    if (result.command.phase === 'accepted') {
      try {
        result = validate(await send(accountId, 'POST', admissions + '/' + saved.commandId + '/execute',
          { protocol: 'admission-v1', generation: result.command.generation }), assignmentId, saved.commandId);
      } catch (cause) {
        if (cause?.admissionStatus !== 410) throw cause;
        // A server-declared expiration may concern either command or renderer
        // lease. Reconcile only this known command, once; DB time decides whether
        // it can be fenced. Never use the browser clock or mint/fallback here.
        result = validate(await send(accountId, 'POST', admissions + '/' + saved.commandId + '/reconcile',
          { protocol: 'admission-v1' }), assignmentId, saved.commandId);
        if (result.command.phase === 'accepted') throw cause; // lease/early: keep intent
      }
      if (result.command.phase === 'unstarted_expired') rejectFenced();
      if (result.command.phase !== 'bound') throw uncertain();
    }
    await assertAccount(accountId);
    // Lost cleanup must not turn a confirmed start into a failure. The pending
    // receipt, if retained, simply recovers the same bound command next time.
    save({ ...saved, state: 'complete' }, false);
    return result;
  }
  return {
    enter(accountId, assignmentId, { allowCreate = true } = {}) {
      const key = keyFor(accountId, assignmentId);
      if (flights.has(key)) return flights.get(key);
      const promise = run(accountId, assignmentId, allowCreate).finally(() => flights.delete(key));
      flights.set(key, promise);
      return promise;
    },
    dispose() { disposed = true; aborters.forEach(controller => controller.abort()); },
  };
}
