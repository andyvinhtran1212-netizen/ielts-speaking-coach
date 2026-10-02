// Optional same-tab drafts. window.name is a candidate tab owner, never auth.
// Native cloned-history/new-document Back support remains a release gate.
import { isLearnerTabPersistenceSupported } from './learner-tab-draft-support.mjs';
export const LEARNER_DRAFT_KEY = 'aver:learner-tab-drafts:v1';
const OWNER_PREFIX = 'aver-learner-drafts-v1:';
const OWNER = /^aver-learner-drafts-v1:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_BYTES = 1024 * 1024;
const MAX_RECORDS = 64;
const exact = (v, keys) => v !== null && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const identity = v => typeof v === 'string' && v.length > 0 && v.length <= 4096;
const revision = v => typeof v === 'string' && v.length > 0 && v.length <= MAX_BYTES;
const clone = v => JSON.parse(JSON.stringify(v));

function decode(raw) {
  if (raw === null) return null;
  if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > MAX_BYTES) throw new Error('corrupt');
  const v = JSON.parse(raw);
  if (!exact(v, ['schema', 'owner', 'drafts']) || v.schema !== 1 || !OWNER.test(v.owner)
      || !Array.isArray(v.drafts) || v.drafts.length > MAX_RECORDS) throw new Error('corrupt');
  const seen = new Set();
  for (const r of v.drafts) {
    if (!exact(r, ['account', 'scope', 'version', 'value']) || !identity(r.account)
        || !identity(r.scope) || !revision(r.version)) throw new Error('corrupt');
    const key = JSON.stringify([r.account, r.scope]);
    if (seen.has(key)) throw new Error('corrupt');
    seen.add(key);
  }
  return v;
}

function write(browser, next) {
  const raw = JSON.stringify(next);
  if (next.drafts.length > MAX_RECORDS || new TextEncoder().encode(raw).length > MAX_BYTES) throw new Error('capacity');
  browser.sessionStorage.setItem(LEARNER_DRAFT_KEY, raw);
  if (browser.sessionStorage.getItem(LEARNER_DRAFT_KEY) !== raw) throw new Error('readback');
}

function initialize(browser, accountId) {
  if (!isLearnerTabPersistenceSupported(browser)) throw new Error('unsupported');
  let owner = browser.name;
  const freshOwner = owner === '';
  if (owner === '') {
    const uuid = browser.crypto.randomUUID();
    owner = OWNER_PREFIX + uuid;
    if (!OWNER.test(owner)) throw new Error('owner');
    browser.name = owner;
    if (browser.name !== owner) throw new Error('owner');
  }
  if (!OWNER.test(owner)) throw new Error('unrelated-name'); // Preserve it.
  if (!freshOwner) {
    // A previously stored owner is usable only if it can still be invalidated.
    // If logout lost both name and storage writes, a later document must not
    // revive that read-only old owner merely because its envelope still fits.
    const challenge = OWNER_PREFIX + browser.crypto.randomUUID();
    if (!OWNER.test(challenge) || challenge === owner) throw new Error('owner');
    browser.name = challenge;
    if (browser.name !== challenge) throw new Error('owner');
    browser.name = owner;
    if (browser.name !== owner) throw new Error('owner');
  }
  let namespace, corrupt = false;
  try { namespace = decode(browser.sessionStorage.getItem(LEARNER_DRAFT_KEY)); }
  catch { namespace = null; corrupt = true; }
  if (freshOwner || !namespace || namespace.owner !== owner) {
    // Purge the entire copied app namespace before any domain read/write.
    browser.sessionStorage.removeItem(LEARNER_DRAFT_KEY);
    if (browser.sessionStorage.getItem(LEARNER_DRAFT_KEY) !== null) throw new Error('purge');
    namespace = { schema: 1, owner, drafts: [] };
    write(browser, namespace);
  }
  if (corrupt) throw new Error('corrupt');
  if (namespace.drafts.some(r => r.account !== accountId)) {
    write(browser, { ...namespace, drafts: namespace.drafts.filter(r => r.account === accountId) });
  }
  return owner;
}

export function invalidateLearnerTabDraftOwner(browser = globalThis.window) {
  try {
    if (!browser || !OWNER.test(browser.name)) return { status: 'ready', reason: 'unrelated-owner' };
    browser.name = '';
    if (browser.name !== '') throw new Error('owner-invalidation');
    return { status: 'ready', reason: 'owner-invalidated' };
  } catch { return { status: 'unavailable', reason: 'owner-invalidation-failed' }; }
}

export function clearLearnerTabDraftAccount(accountId, browser = globalThis.window) {
  try {
    if (!identity(accountId) || !browser || !OWNER.test(browser.name)) throw new Error('identity');
    const previousOwner = browser.name;
    // Invalidate existing handles before optional storage work. A denied clear
    // must not leave the old owner usable on same-account login or BFCache.
    if (invalidateLearnerTabDraftOwner(browser).status !== 'ready') throw new Error('owner-invalidation');
    const namespace = decode(browser.sessionStorage.getItem(LEARNER_DRAFT_KEY));
    if (!namespace) return { status: 'ready', reason: 'empty' };
    if (namespace.owner !== previousOwner) throw new Error('owner-changed');
    write(browser, { ...namespace, drafts: namespace.drafts.filter(r => r.account !== accountId) });
    return { status: 'ready', reason: 'account-cleared' };
  } catch { return { status: 'unavailable', reason: 'account-clear-failed' }; }
}

export function createLearnerTabDrafts({ accountId, scope, version, validate, getAccountId, window: browser = globalThis.window }) {
  let owner = null, disposed = false, failed = null;
  const result = (value = null, restored = false, reason = 'empty') => ({
    value, restored, status: failed ? 'unavailable' : 'ready', reason: failed || reason,
  });
  try {
    if (!identity(accountId) || !identity(scope) || !revision(version) || typeof validate !== 'function'
        || typeof getAccountId !== 'function' || getAccountId() !== accountId) throw new Error('identity');
    owner = initialize(browser, accountId);
  } catch { failed = 'persistence-unavailable'; }
  function current() {
    if (failed || disposed || getAccountId() !== accountId || browser.name !== owner) throw new Error('guard');
    const namespace = decode(browser.sessionStorage.getItem(LEARNER_DRAFT_KEY));
    if (!namespace || namespace.owner !== owner) throw new Error('guard');
    return namespace;
  }
  function attempt(fn) {
    try { return fn(current()); }
    catch { failed = 'draft-not-saved'; return result(); }
  }
  const isScope = r => r.account === accountId && r.scope === scope;
  return {
    read() { return attempt(namespace => {
      const row = namespace.drafts.find(isScope);
      if (!row) return result();
      if (row.version !== version || validate(clone(row.value)) !== true) {
        write(browser, { ...namespace, drafts: namespace.drafts.filter(r => !isScope(r)) });
        return result(null, false, 'incompatible-cleared');
      }
      return result(clone(row.value), true, 'restored');
    }); },
    save(value) { return attempt(namespace => {
      const copy = clone(value);
      if (validate(copy) !== true) throw new Error('shape');
      write(browser, { ...namespace, drafts: [...namespace.drafts.filter(r => !isScope(r)),
        { account: accountId, scope, version, value: copy }] });
      return result(null, false, 'saved');
    }); },
    discard() { return attempt(namespace => {
      write(browser, { ...namespace, drafts: namespace.drafts.filter(r => !isScope(r)) });
      return result(null, false, 'discarded');
    }); },
    dispose() { disposed = true; },
  };
}
