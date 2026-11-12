import {
  ExerciseBookError,
  type ErrorCode,
  type ExerciseBookApi,
  type PageQuery,
  type ReadOptions,
  type SaveOptions,
} from './contract';

/** The full `code` set of contract §0 (v1.3.1). */
const KNOWN_CODES = new Set<ErrorCode>([
  'unauthorized', 'not_granted', 'not_owner', 'step_up_required', 'mfa_required', 'not_found',
  'stale_revision', 'idempotency_conflict', 'attempt_changed', 'already_archived', 'grant_state_unchanged',
  'activity_locked', 'past_due', 'validation', 'unavailable',
]);

/** §0: a body without `code` (uuid_parsing 422, the global handler) is mapped by status. */
const STATUS_CODE: Record<number, ErrorCode> = {
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  422: 'validation',
};

/**
 * Map a window.api rejection to a fixed {status, code, reason}. api.js sets
 * `.code` and `.reason` from the top-level fields of the §0 body (v1.3.1) or
 * from an object `detail` of older routes. The server message itself is
 * dropped so no wire text reaches the UI or an error report.
 */
export function toExerciseBookError(caught: unknown): ExerciseBookError {
  if (caught instanceof ExerciseBookError) return caught;
  const value = (caught && typeof caught === 'object' ? caught : {}) as { status?: unknown; detail?: unknown; code?: unknown; reason?: unknown };
  const status = typeof value.status === 'number' ? value.status : 0;
  const detail = value.detail && typeof value.detail === 'object' && !Array.isArray(value.detail)
    ? value.detail as { code?: unknown; reason?: unknown }
    : null;
  const wire = detail?.code ?? value.code;
  const reason = (detail?.reason ?? value.reason) === 'new_factor_cooloff' ? 'new_factor_cooloff' : null;
  if (typeof wire === 'string' && KNOWN_CODES.has(wire as ErrorCode)) return new ExerciseBookError(status, wire as ErrorCode, wire === 'step_up_required' ? reason : null);
  return new ExerciseBookError(status, STATUS_CODE[status] || (status >= 500 ? 'unavailable' : 'network'));
}

const e = encodeURIComponent;

function pageSuffix(page?: PageQuery) {
  const query = new URLSearchParams();
  if (page?.limit) query.set('limit', String(page.limit));
  if (page?.cursor) query.set('cursor', page.cursor);
  const text = query.toString();
  return text ? `?${text}` : '';
}

async function call<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (caught) {
    throw toExerciseBookError(caught);
  }
}

/** Real adapter over the shared authenticated transport (routes of contract v1). */
export function createHttpExerciseBookApi(): ExerciseBookApi {
  // api.js `noRedirect` skips its 401/403 side effects (login redirect, step-up prompt) for probes.
  const get = <T>(path: string, options?: ReadOptions) =>
    call(() => (options?.quiet ? window.api.getWith<T>(path, undefined, { noRedirect: true }) : window.api.getWith<T>(path)));
  const post = <T>(path: string, body: unknown) => call(() => window.api.postWith<T>(path, body));
  // `keepalive` lets a leave-time save finish after the document is gone (api.js never prompts for step-up on it).
  const patch = <T>(path: string, body: unknown, options?: SaveOptions) =>
    call(() => (options?.keepalive ? window.api.patchWith<T>(path, body, undefined, { keepalive: true }) : window.api.patchWith<T>(path, body)));
  const cohort = (id: string) => `/admin/cohorts/${e(id)}`;
  const assignments = (id: string) => `${cohort(id)}/listening-source-assignments`;
  const classItem = (id: string) => `class_item=${e(id)}`;
  return {
    getCatalog: (cohortId, options) => get(`${cohort(cohortId)}/listening-source-catalog`, options),
    createAssignment: (cohortId, body) => post(assignments(cohortId), body),
    listAssignments: (cohortId, page) => get(`${assignments(cohortId)}${pageSuffix(page)}`),
    getAssignment: (cohortId, id) => get(`${assignments(cohortId)}/${e(id)}`),
    archiveAssignment: (cohortId, id, body) => patch(`${assignments(cohortId)}/${e(id)}`, body),
    getProgress: (cohortId, id) => get(`${assignments(cohortId)}/${e(id)}/progress`),
    getTeacherReview: (cohortId, id, itemId, activityId) =>
      get(`${cohort(cohortId)}/assignments/${e(id)}/items/${e(itemId)}/listening-review?activity_id=${e(activityId)}`),
    listMyAssignments: (page) => get(`/api/listening/exercise-book-assignments${pageSuffix(page)}`),
    getPlayer: (testId, item) => get(`/api/listening/tests/${e(testId)}?${classItem(item)}`),
    getInProgress: (testId, item) => get(`/api/listening/tests/${e(testId)}/attempts/in-progress?${classItem(item)}`),
    startAttempt: (testId, item, binding) =>
      post(`/api/listening/tests/${e(testId)}/attempts?${classItem(item)}`, { blackeye_binding: binding }),
    saveAnswer: (attemptId, body, options) => patch(`/api/listening/tests/attempts/${e(attemptId)}/answers`, body, options),
    submitAttempt: (attemptId, body) => post(`/api/listening/tests/attempts/${e(attemptId)}/submit`, body),
    getAttempt: (attemptId) => get(`/api/listening/tests/attempts/${e(attemptId)}`),
    playbackStarted: async (attemptId) => {
      await post(`/api/listening/tests/attempts/${e(attemptId)}/playback-started`, { playback_claim_id: crypto.randomUUID() });
    },
    getReview: (attemptId) => get(`/api/listening/tests/attempts/${e(attemptId)}/review`),
    getGrants: (cohortId, options) => get(`${cohort(cohortId)}/exercise-book-grants`, options),
    recordGrant: (cohortId, body) => post(`${cohort(cohortId)}/exercise-book-grants`, body),
    getGrantLog: (cohortId, page) => get(`${cohort(cohortId)}/exercise-book-grants/log${pageSuffix(page)}`),
  };
}
