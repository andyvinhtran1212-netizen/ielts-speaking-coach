'use client';

// EXAMROOM-0066 FR-027: Reading short answer. Same gap and word limit as
// GapFill; the answer goes back exactly as typed.
import { GapFill } from './gap-fill';
import type { AnswerProps } from './types';

export function ShortAnswer(props: AnswerProps & { q: number; prompt: string; wordLimit?: string | null }) {
  return <GapFill {...props} kind="short-answer" />;
}
