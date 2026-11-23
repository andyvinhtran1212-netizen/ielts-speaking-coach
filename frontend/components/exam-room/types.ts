// EXAMROOM-0066 plan.md "Data and contracts": the contract between the exam room
// frame and the player that mounts it. The frame never calls an API; each player
// keeps its own save/submit functions and passes them in.
import type { ReactNode } from 'react';

export type ExamRoomMode = 'test' | 'practice';
// 'listening-practice': Listening practice (0066 amendment 1 (b)); 'listening' stays for full test, mini test and drill.
export type ExamRoomSurface = 'reading' | 'listening' | 'listening-practice' | 'mock' | 'writing' | 'speaking' | 'drill';

export interface ExamRoomSection { id: string; kind: 'passage' | 'part' | 'task'; index: number; firstQ: number; lastQ: number }
export interface ExamRoomQuestion { q: number; sectionId: string; answered: boolean; flagged: boolean; saveState?: 'pending' | 'retrying' | 'failed' }

export type ExamRoomSaveStatus =
  | { state: 'idle'; lastSavedAt?: Date }
  | { state: 'saving'; lastSavedAt?: Date }
  | { state: 'saved'; lastSavedAt: Date }
  | { state: 'retrying'; lastSavedAt?: Date; unsaved: number }
  | { state: 'failed'; lastSavedAt?: Date; unsaved: number; onRetry(): void };

export type ExamRoomSubmitOutcome =
  | 'idle' | 'submitting' | 'confirmed' | 'unconfirmed' | 'unconfirmed_manual' | 'closed_unconfirmed'
  /** 0066 amendment 1 (a): the server refused a submit that arrived after the grace period. */
  | 'expired_unsubmitted';

export type ExamRoomTimer =
  | { kind: 'countdown'; remainingSeconds: number; onExpire(): void }
  | { kind: 'elapsed'; elapsedSeconds: number; maxSeconds?: number }
  | null;

export type ExamRoomLayout =
  | { kind: 'split'; left: ReactNode; right: ReactNode; leftLabel: string; rightLabel: string }
  | { kind: 'single'; body: ReactNode };

export interface ExamRoomSubmit {
  label: string;
  /** Title of the submit box when no question is blank (default "Submit test?" / "Nộp bài?"). The blank-count title stays. */
  title?: string;
  /** The box's stay button (default "Return to test" / its Vietnamese line). */
  cancelLabel?: string;
  onSubmit(): Promise<void>;
  disabledReason?: string;
  costNote?: string;
  extraWarning?: ReactNode;
  /** FR-034: only the player sets `confirmed`, after a canonical server ack. */
  outcome?: ExamRoomSubmitOutcome;
  savedUpTo?: string;
  closedAt?: string;
  onRetry?: () => void;
}

export interface ExamRoomExit {
  href: string;
  /** Saves what is left; resolves with the number of answers still unsaved. */
  flush(): Promise<{ unsaved: number }>;
  losesWork(): boolean;
  abandon?: { onAbandon(): Promise<void> };
  /** One extra line in the leave box (e.g. Listening test FR-011), in the room's language. */
  note?: string;
  /** True closes an open leave box and keeps it closed, e.g. while a proctor collects the test. */
  locked?: boolean;
}

/**
 * Session state the player learned from its own requests (FR-015, FR-016).
 * Addition to plan.md: the frame cannot see a 401 itself, so the player says so.
 */
export type ExamRoomSession = 'active' | 'expired' | 'displaced' | 'not_current';

export interface ExamRoomTabGuardOptions {
  /**
   * Before handing over (FR-017): resolves `secured: true` only when every answer
   * is acked by the server or sits in a local copy that was read back. Default:
   * `exit.flush()`, secured when nothing is left unsaved.
   */
  flush?(): Promise<{ secured: boolean; unsaved?: number }>;
  /** Reads the attempt again from the server once this tab holds the write right (FR-017). */
  reloadFromServer(): Promise<unknown>;
  /** Told whenever this tab may or may not save or submit. */
  onWriteRightChange?(canWrite: boolean): void;
}

export interface ExamRoomShellProps {
  mode: ExamRoomMode;
  surface: ExamRoomSurface;
  embedded?: boolean;
  /**
   * The host page keeps its own top bar (e.g. the Listening 80-day page, 0069 FR-011):
   * no FocusShell bar, leave box or abandon button; the host owns navigation. Banners,
   * save status, navigator, submit box, session box and the tab guard stay.
   */
  bare?: boolean;
  isFullTest?: boolean;
  attemptKey: string;
  title: string;
  subtitle?: string;
  timer?: ExamRoomTimer;
  saveStatus: ExamRoomSaveStatus;
  sections?: ExamRoomSection[];
  questions?: ExamRoomQuestion[];
  currentQ?: number;
  onJump?(q: number): void;
  onToggleFlag?(q: number): void;
  flagsReady?: boolean;
  layout: ExamRoomLayout;
  submit?: ExamRoomSubmit;
  exit: ExamRoomExit;
  /** Account id, or the share-link guest scope (FR-035). */
  ownerKey: string;
  /** `saveLocalCopy` returns true when the copy was written and read back. */
  onSessionExpired?: { saveLocalCopy(): boolean; returnUrl: string };
  onSessionConflict?(kind: 'displaced' | 'not_current'): void;
  timeUpChoice?: { onSend(): Promise<void>; onDiscard(): Promise<void>; costNote?: string };
  /** See ExamRoomSession. Default `active`. */
  session?: ExamRoomSession;
  /** One writing tab per attempt (FR-017). Without it the guard is off. */
  tabGuard?: ExamRoomTabGuardOptions;
  /** FR-033 events; defaults to `POST /api/analytics/events`. Tests pass a spy. */
  track?(name: string, props?: Record<string, string | number | boolean>): void;
  /** Tests and the screenshot page only: width instead of the window's. */
  viewportWidth?: number;
}
