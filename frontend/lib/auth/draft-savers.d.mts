export type DraftSaver = () => unknown;
export function registerDraftSaver(saver: DraftSaver): () => void;
export function saveAllDrafts(timeoutMs?: number): Promise<number>;
export function resetDraftSavers(): void;
