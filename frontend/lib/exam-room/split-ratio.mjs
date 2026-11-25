// @ts-check
// EXAMROOM-0066 FR-003–FR-005: the two-column split. The learner's preferred
// ratio is stored per attempt; the drawn ratio is that preference clamped to
// 30–70 % with at least 360 px on each side, so a narrow window squeezes it and
// a wider one gives the old ratio back. Under 900 px the split becomes two tabs.

export const SPLIT_MIN = 30;
export const SPLIT_MAX = 70;
export const SPLIT_DEFAULT = 50;
export const SPLIT_STEP = 5;
export const SPLIT_MIN_PX = 360;
export const SPLIT_TABS_BELOW = 900;
export const SPLIT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PREFIX = 'exam-room:split:';

/** @param {number} width @returns {'split' | 'tabs'} */
export function splitLayout(width) {
  return Number.isFinite(width) && width < SPLIT_TABS_BELOW ? 'tabs' : 'split';
}

/**
 * Bounds of the left column in percent for a container width.
 * @param {number} [containerWidth]
 */
export function splitBounds(containerWidth) {
  if (!Number.isFinite(containerWidth) || /** @type {number} */ (containerWidth) <= 0) return { min: SPLIT_MIN, max: SPLIT_MAX };
  const minPx = (SPLIT_MIN_PX / /** @type {number} */ (containerWidth)) * 100;
  const min = Math.max(SPLIT_MIN, minPx);
  const max = Math.min(SPLIT_MAX, 100 - minPx);
  // Too narrow to keep 360 px on both sides: centre (tabs take over below 900 px anyway).
  if (min > max) return { min: 50, max: 50 };
  return { min, max };
}

/**
 * The ratio to draw: the preference clamped to the bounds, rounded to a whole
 * percent (also the separator's aria-valuenow).
 * @param {number} ratio
 * @param {number} [containerWidth]
 */
export function clampRatio(ratio, containerWidth) {
  const { min, max } = splitBounds(containerWidth);
  const r = Number.isFinite(ratio) ? ratio : SPLIT_DEFAULT;
  return Math.round(Math.min(max, Math.max(min, r)));
}

/**
 * Ratio from a pointer position inside the container.
 * @param {number} offsetX pointer x relative to the container's left edge
 * @param {number} containerWidth
 */
export function ratioFromPointer(offsetX, containerWidth) {
  if (!(containerWidth > 0)) return SPLIT_DEFAULT;
  return clampRatio((offsetX / containerWidth) * 100, containerWidth);
}

/**
 * Keyboard and double-click on the separator (FR-003): arrows ±5, Home 30,
 * End 70, Enter or double-click 50. Returns null for other keys.
 * @param {number} ratio current preference
 * @param {string} key KeyboardEvent.key, or 'dblclick'
 * @param {number} [containerWidth]
 * @returns {number | null}
 */
export function ratioForKey(ratio, key, containerWidth) {
  const current = clampRatio(ratio, containerWidth);
  switch (key) {
    case 'ArrowLeft': return clampRatio(current - SPLIT_STEP, containerWidth);
    case 'ArrowRight': return clampRatio(current + SPLIT_STEP, containerWidth);
    case 'Home': return clampRatio(SPLIT_MIN, containerWidth);
    case 'End': return clampRatio(SPLIT_MAX, containerWidth);
    case 'Enter':
    case 'dblclick': return clampRatio(SPLIT_DEFAULT, containerWidth);
    default: return null;
  }
}

/** @param {string} attemptKey */
export function splitStorageKey(attemptKey) {
  return `${PREFIX}${attemptKey}`;
}

/**
 * Stored preference for this attempt; a new attempt starts at 50. Entries older
 * than 7 days are removed. Storage errors fall back to 50.
 * @param {Storage | null | undefined} storage
 * @param {string} attemptKey
 * @param {number} [now]
 */
export function readSplitRatio(storage, attemptKey, now = Date.now()) {
  if (!storage || !attemptKey) return SPLIT_DEFAULT;
  try {
    const raw = storage.getItem(splitStorageKey(attemptKey));
    if (!raw) return SPLIT_DEFAULT;
    const value = JSON.parse(raw);
    if (!value || typeof value.ratio !== 'number' || typeof value.savedAt !== 'number' || now - value.savedAt > SPLIT_TTL_MS) {
      storage.removeItem(splitStorageKey(attemptKey));
      return SPLIT_DEFAULT;
    }
    return Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, value.ratio));
  } catch {
    return SPLIT_DEFAULT;
  }
}

/**
 * @param {Storage | null | undefined} storage
 * @param {string} attemptKey
 * @param {number} ratio
 * @param {number} [now]
 * @returns {boolean} whether it was stored
 */
export function writeSplitRatio(storage, attemptKey, ratio, now = Date.now()) {
  if (!storage || !attemptKey || !Number.isFinite(ratio)) return false;
  try {
    storage.setItem(splitStorageKey(attemptKey), JSON.stringify({ ratio: Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, Math.round(ratio))), savedAt: now }));
    return true;
  } catch {
    return false;
  }
}

/** Remove the ratio when the attempt is submitted. @param {Storage | null | undefined} storage @param {string} attemptKey */
export function clearSplitRatio(storage, attemptKey) {
  try { storage?.removeItem(splitStorageKey(attemptKey)); } catch { /* storage unavailable */ }
}

/**
 * Remove every stored ratio older than 7 days (or unreadable).
 * @param {Storage | null | undefined} storage
 * @param {number} [now]
 * @returns {number} entries removed
 */
export function pruneSplitRatios(storage, now = Date.now()) {
  if (!storage) return 0;
  const stale = [];
  try {
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (!key || !key.startsWith(PREFIX)) continue;
      let ok = false;
      try {
        const value = JSON.parse(storage.getItem(key) || 'null');
        ok = Boolean(value) && typeof value.savedAt === 'number' && now - value.savedAt <= SPLIT_TTL_MS;
      } catch { ok = false; }
      if (!ok) stale.push(key);
    }
    for (const key of stale) storage.removeItem(key);
  } catch {
    return 0;
  }
  return stale.length;
}
