// One session per learner account, browser side (ENROLL-0060 G05-T20,
// FR-052 / FR-053). The server (G04-T09, routers/account_session.py) decides
// everything: whether the rule applies (`enabled`), whether another device is
// open, whether it is inside timed work and how many minutes are left. This
// module only maps those answers to what the page shows; it never guesses
// "timed work" in the browser.

export const SESSION_DISPLACED_EVENT = 'aver:session-displaced';
export const DISPLACED_NOTICE = 'displaced';
export const DISPLACED_LOGIN_PATH = '/login?notice=displaced';
const DISPLACED_MEMO_KEY = 'aver:session-displaced:v1';
const NOTICES = new Set([DISPLACED_NOTICE]);

/**
 * `GET /api/account/session/status` → what the device that just signed in does.
 * 'proceed': rule off, this device is the current one, or anything unknown
 * (an API failure never blocks sign-in). 'ask': screen 8a. 'blocked': 8b.
 */
export function sessionGateView(status) {
  if (!status || typeof status !== 'object' || status.enabled !== true) return 'proceed';
  if (status.state === 'other_device_timed') return 'blocked';
  if (status.state === 'other_device') return 'ask';
  return 'proceed';
}

/** True only for the server's `session_displaced` refusal. */
export function isDisplaced(error) {
  if (!error || typeof error !== 'object') return false;
  const detail = error.detail && typeof error.detail === 'object' ? error.detail : null;
  return (detail ? detail.error_code : error.error_code) === 'session_displaced';
}

/** `?notice=` of /login, only from the allow-list; anything else → null. */
export function loginNotice(search) {
  let value = null;
  try { value = new URLSearchParams(typeof search === 'string' ? search : '').get('notice'); } catch { value = null; }
  return value && NOTICES.has(value) ? value : null;
}

/** "còn khoảng N phút": the server's number, rounded up, never below 1. */
export function minutesLeftText(minutes) {
  const n = typeof minutes === 'number' && Number.isFinite(minutes) ? Math.max(1, Math.ceil(minutes)) : null;
  return n === null ? null : `còn khoảng ${n} phút`;
}

const session = (browser) => {
  try { return browser?.sessionStorage ?? null; } catch { return null; }
};

/** Keeps the email and time for screen 8c across the sign-out navigation. */
export function rememberDisplaced({ email, at, draftsSaved }, browser = globalThis.window) {
  const store = session(browser);
  if (!store) return;
  const memo = {
    email: typeof email === 'string' && email ? email : null,
    at: typeof at === 'string' && at ? at : null,
    draftsSaved: draftsSaved === true,
  };
  try { store.setItem(DISPLACED_MEMO_KEY, JSON.stringify(memo)); } catch { /* 8c still shows, without the details */ }
}

/** Reads (and removes) what rememberDisplaced kept; missing parts are null. */
export function takeDisplaced(browser = globalThis.window) {
  const store = session(browser);
  const empty = { email: null, at: null, draftsSaved: false };
  if (!store) return empty;
  let raw = null;
  try { raw = store.getItem(DISPLACED_MEMO_KEY); store.removeItem(DISPLACED_MEMO_KEY); } catch { return empty; }
  try {
    const memo = JSON.parse(raw ?? 'null');
    return {
      email: typeof memo?.email === 'string' ? memo.email : null,
      at: typeof memo?.at === 'string' ? memo.at : null,
      draftsSaved: memo?.draftsSaved === true,
    };
  } catch { return empty; }
}
