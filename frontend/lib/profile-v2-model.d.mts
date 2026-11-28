export type LoginEventRow = { device: string; at: string | null; method: string | null; outcome: string | null; current: boolean };
export const OUTCOME_TEXT: Readonly<Record<string, string>>;
export function formatVnDateTime(iso: unknown): string | null;
export function loginEventRows(raw: unknown): LoginEventRow[] | null;
export function signInMethodLine(user: unknown): string | null;
export const WEEKLY_GOALS: readonly number[];
