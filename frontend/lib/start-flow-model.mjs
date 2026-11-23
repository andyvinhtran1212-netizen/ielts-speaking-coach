// "Lần đầu vào" at /start (LEARNERCORE-0063 FR-065; sheet TroGiupLanDau
// screen 2). Pure decisions, so the page and its tests share one truth.
import { sanitizeLearnerNext } from './safe-next.mjs';

/** Band choices of step 2; '' is "Chưa biết" (nothing is saved). */
export const START_BANDS = Object.freeze(['5.5', '6.0', '6.5', '7.0', '7.5']);

/**
 * Where /start sends the visitor before drawing anything.
 * - a valid `next` (ENROLL-0060 FR-031) wins: the visitor came for that page;
 * - a finished onboarding never shows again → `/home`;
 * - otherwise the steps are shown (`null`).
 * @param {{ onboarding_completed?: unknown } | null} me @param {unknown} next
 * @returns {string | null}
 */
export function startRedirect(me, next) {
  const target = sanitizeLearnerNext(typeof next === 'string' ? next : null);
  if (target) return target;
  if (me?.onboarding_completed === true) return '/home';
  return null;
}

/**
 * True when `GET /api/me/courses` (G04) holds an active online course.
 * Missing route, error or another shape → false (FR-065: nothing guessed).
 * @param {unknown} payload @returns {boolean}
 */
export function hasActiveOnlineCourse(payload) {
  const items = payload && typeof payload === 'object' ? /** @type {any} */ (payload).items : null;
  return Array.isArray(items) && items.some((item) => item?.kind === 'online' && item?.state === 'active');
}

/** True when `GET /api/class/me?summary=true` says the learner is in a class. */
export function hasClass(payload) {
  return Boolean(payload && typeof payload === 'object' && /** @type {any} */ (payload).has_class === true);
}

/**
 * The pre-chosen starting point of step 3 (FR-065). A class hides step 3: the
 * flow ends at the assigned work instead (`'class'`).
 * @param {{ online: boolean, inClass: boolean }} facts
 * @returns {'class' | 'online' | 'none'}
 */
export function startingPoint({ online, inClass }) {
  if (inClass) return 'class';
  return online ? 'online' : 'none';
}

/**
 * Body of the step-2 save: only the fields the learner set. A band outside
 * the choices or a malformed date is left out rather than sent.
 * @param {{ band: string, examDate: string }} goal
 * @returns {{ target_band?: number, exam_date?: string }}
 */
export function goalPayload({ band, examDate }) {
  /** @type {{ target_band?: number, exam_date?: string }} */
  const body = {};
  if (START_BANDS.includes(band)) body.target_band = Number(band);
  if (/^\d{4}-\d{2}-\d{2}$/.test(examDate) && !Number.isNaN(Date.parse(`${examDate}T00:00:00Z`))) body.exam_date = examDate;
  return body;
}
