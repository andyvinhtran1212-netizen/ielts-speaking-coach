// @ts-check
// EXAMROOM-0066 FR-022: the one place that decides whether a surface renders
// the shared exam room. Source (option A): window.__AVER_RUNTIME_CONFIG__
// .examRoomSurfaces, written at build time by tooling/generate-runtime-config.mjs.
// A `?exam_room=on|off` override is for staging trials only: it is ignored when
// the environment is production or unknown (a missing environment counts as
// production).

/** @typedef {'reading' | 'listening' | 'mock' | 'writing' | 'speaking' | 'drill'} ExamRoomSurface */

/** @type {readonly ExamRoomSurface[]} */
export const EXAM_ROOM_SURFACES = Object.freeze(['reading', 'listening', 'mock', 'writing', 'speaking', 'drill']);

/**
 * Known surface names from a config value; anything else is dropped.
 * @param {unknown} value
 * @returns {ExamRoomSurface[]}
 */
export function parseExamRoomSurfaces(value) {
  if (!Array.isArray(value)) return [];
  /** @type {ExamRoomSurface[]} */
  const out = [];
  for (const item of value) {
    const name = typeof item === 'string' ? item.trim().toLowerCase() : '';
    if (EXAM_ROOM_SURFACES.includes(/** @type {ExamRoomSurface} */ (name)) && !out.includes(/** @type {ExamRoomSurface} */ (name))) {
      out.push(/** @type {ExamRoomSurface} */ (name));
    }
  }
  return out;
}

/**
 * The staging override from the page URL: 'on', 'off' or null.
 * @param {string | URLSearchParams | null | undefined} search
 * @returns {'on' | 'off' | null}
 */
export function examRoomOverride(search) {
  if (!search) return null;
  let value = null;
  try {
    value = (typeof search === 'string' ? new URLSearchParams(search) : search).get('exam_room');
  } catch {
    return null;
  }
  return value === 'on' || value === 'off' ? value : null;
}

function defaultConfig() {
  try {
    return /** @type {any} */ (globalThis).window?.__AVER_RUNTIME_CONFIG__ ?? null;
  } catch {
    return null;
  }
}

function defaultSearch() {
  try {
    return /** @type {any} */ (globalThis).window?.location?.search ?? '';
  } catch {
    return '';
  }
}

/**
 * Whether `surface` renders the exam room on this page load.
 * @param {string} surface
 * @param {{ config?: any, search?: string | URLSearchParams | null }} [options]
 *   Injected in tests; defaults read the browser globals.
 * @returns {boolean}
 */
export function examRoomEnabled(surface, options = {}) {
  if (!EXAM_ROOM_SURFACES.includes(/** @type {ExamRoomSurface} */ (surface))) return false;
  const config = 'config' in options ? options.config : defaultConfig();
  const environment = config && typeof config.environment === 'string' ? config.environment : null;
  if (environment && environment !== 'production') {
    const override = examRoomOverride('search' in options ? options.search : defaultSearch());
    if (override) return override === 'on';
  }
  return parseExamRoomSurfaces(config?.examRoomSurfaces).includes(/** @type {ExamRoomSurface} */ (surface));
}
