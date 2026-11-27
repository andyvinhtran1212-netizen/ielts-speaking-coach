export type LocalDraft = { text: string; base: string | null; savedAt: number };

export declare const LOCAL_DRAFT_MAX_AGE_MS: number;
export declare const LOCAL_DRAFT_MAX_CHARS: number;

export declare function keepLocalDraft(
  storage: Storage | null | undefined,
  input: { accountId: string | null; assignmentId: string | null; text: string; base?: string | null; now?: number },
): boolean;
export declare function readLocalDraft(
  storage: Storage | null | undefined,
  accountId: string | null,
  assignmentId: string | null,
  now?: number,
): LocalDraft | null;
export declare function clearLocalDraft(
  storage: Storage | null | undefined,
  accountId: string | null,
  assignmentId: string | null,
): void;
export declare function settleLocalDraft(
  storage: Storage | null | undefined,
  accountId: string | null,
  assignmentId: string | null,
  savedText: string,
): void;
export declare function localDraftDecision(
  local: LocalDraft | null,
  serverText: string | null | undefined,
  serverUpdatedAt: string | null | undefined,
): 'none' | 'restore' | 'offer';
