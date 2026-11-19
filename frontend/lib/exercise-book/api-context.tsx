'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';

import { createExerciseBookApi } from './client';
import type { ExerciseBookApi } from './contract';

const ExerciseBookApiContext = createContext<ExerciseBookApi | null>(null);

/** Tests pass `api` (the mock); pages use the binding of client.ts. */
export function ExerciseBookApiProvider({ api, children }: { api?: ExerciseBookApi; children: ReactNode }) {
  const [value] = useState(() => api || createExerciseBookApi());
  return <ExerciseBookApiContext.Provider value={value}>{children}</ExerciseBookApiContext.Provider>;
}

export function useExerciseBookApi() {
  const api = useContext(ExerciseBookApiContext);
  if (!api) throw new Error('useExerciseBookApi must be rendered inside ExerciseBookApiProvider');
  return api;
}
