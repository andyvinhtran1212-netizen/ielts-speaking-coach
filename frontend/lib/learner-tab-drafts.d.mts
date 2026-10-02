export type DraftResult<T> = { value: T | null; restored: boolean; status: 'ready' | 'unavailable'; reason: string };
export type TabDraft<T> = { read(): DraftResult<T>; save(value: T): DraftResult<T>; discard(): DraftResult<T>; dispose(): void };
export const LEARNER_DRAFT_KEY: string;
export function createLearnerTabDrafts<T>(options: {
  accountId: string; scope: string; version: string; validate(value: unknown): boolean;
  getAccountId(): string | null; window?: Window;
}): TabDraft<T>;
export function clearLearnerTabDraftAccount(accountId: string, browser?: Window): { status: 'ready' | 'unavailable'; reason: string };
export function invalidateLearnerTabDraftOwner(browser?: Window): { status: 'ready' | 'unavailable'; reason: string };
