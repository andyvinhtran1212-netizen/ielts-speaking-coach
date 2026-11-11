import { ExerciseBookError, type ExerciseBookApi } from './contract';

/**
 * The ONE binding between the exercise-book UI and a backend.
 *
 * PR D's routes are not deployed yet, so deployed builds answer every call with
 * the contract's 503 `unavailable`: screens fail closed and visibly, and the
 * admin/learner entry links stay hidden. `next dev` runs on the typed mocks of
 * contract §7; the `import()` sits inside the development-only branch so a
 * production build drops it with the fixtures. When PR D is live, replace the
 * body of this function with `return createHttpExerciseBookApi();` from
 * './http-api' (one-file swap).
 */
export function createExerciseBookApi(): ExerciseBookApi {
  if (process.env.NODE_ENV === 'development') {
    return deferred(import('./mock-api').then((module) => module.createMockExerciseBookApi()));
  }
  return new Proxy({} as ExerciseBookApi, {
    get: () => async () => { throw new ExerciseBookError(503, 'unavailable'); },
  });
}

function deferred(ready: Promise<ExerciseBookApi>): ExerciseBookApi {
  return new Proxy({} as ExerciseBookApi, {
    get: (_target, method: keyof ExerciseBookApi) => async (...args: unknown[]) => {
      const api = await ready;
      return (api[method] as (...values: unknown[]) => Promise<unknown>)(...args);
    },
  });
}
