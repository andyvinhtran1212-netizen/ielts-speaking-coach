import type { DisplayState, ExamMode, OrgExam, Skill } from './mock-exam-org-model.mjs';

export type RecordTabId = 'de' | 'thi-sinh' | 'theo-doi' | 'cham' | 'phan-tich' | 'tra-ket-qua' | 'nhat-ky';
export type TimedSection = 'listening' | 'reading' | 'writing';
export type ActiveSection = 'not_started' | TimedSection | 'done';
export type SelfPacedState = 'not_started' | 'in_progress' | 'submitted' | 'missed';

export type SectionState = {
  state: 'absent' | 'waiting' | 'working' | 'submitted' | 'missed';
  answered: number | null;
  total: number | null;
  submittedAt: string | null;
  lastActivityAt: string | null;
  live: boolean;
  stalled: boolean;
};

export type MonitorStudent = {
  key: string;
  userId: string | null;
  sittingId: string | null;
  name: string;
  started: boolean;
  inRoster: boolean;
  status: string | null;
  skills: Skill[] | null;
  sections: Partial<Record<TimedSection, SectionState>>;
  needsRetest: boolean;
  selfPaced: {
    state: SelfPacedState;
    currentSection: TimedSection | null;
    timeLeftSeconds: number | null;
    expectedEndAt: string | null;
    fromServer: boolean;
  } | null;
};

export type Monitor = {
  exam: {
    id: string;
    code: string | null;
    title: string;
    mode: ExamMode;
    isOpen: boolean;
    activeSection: ActiveSection;
    collectedSection: string | null;
    sweepDoneSection: string | null;
    timeLeftSeconds: number | null;
    configured: TimedSection[];
    rosterSource: string | null;
  };
  idleMinutes: number | null;
  students: MonitorStudent[];
  serverTime: string | null;
  readAt: number;
};

export type ProctorState = {
  next: TimedSection | null;
  paused: boolean;
  collecting: boolean;
  open: { enabled: boolean; label: string };
  start: { enabled: boolean; label: string };
  collect: { enabled: boolean; label: string };
};

export type RosterEntry = { reviewId: string | null; flags: Skill[]; allowed: Skill[]; sittingStatus: string | null };

export type CandidateRow = {
  key: string;
  name: string;
  userId: string | null;
  sittingId: string | null;
  source: string;
  skills: Skill[] | null;
  started: boolean;
  status: string | null;
  retestFlags: Skill[];
  retestAllowed: Skill[];
  canFlag: boolean;
};

export type RecordEvent = { id: string; kind: string | null; label: string; at: string | null; actor: string; detail: string };

export const RECORD_TABS: readonly { id: RecordTabId; label: string }[];
export const SECTION_NAMES: Readonly<Record<ActiveSection, string>>;
export const SELF_PACED_LABELS: Readonly<Record<SelfPacedState, string>>;
export const EVENT_LABELS: Readonly<Record<string, string>>;
export function recordTab(param: string | null | undefined, state: DisplayState | null): RecordTabId;
export function recordHref(examId: string, tab: RecordTabId): string;
export function stateLabelOf(state: DisplayState | null): string;
export function normalizeMonitor(value: unknown, now?: number): Monitor | null;
export function liveAlerts(monitor: Monitor | null, now?: number): { offline: string[]; idle: string[]; absent: string[] };
export function proctorState(monitor: Monitor, stale: boolean): ProctorState;
export type ProctorSnapshot = { examId: string; isOpen: boolean; activeSection: ActiveSection; collectedSection: string | null; sweepDoneSection: string | null };
export function proctorSnapshot(monitor: Monitor): ProctorSnapshot;
export function sameProctorSnapshot(a: ProctorSnapshot | null | undefined, b: ProctorSnapshot | null | undefined): boolean;
export function answeredCopy(section: SectionState | null | undefined): string;
export function clockCopy(seconds: number | null): string;
export function timeCopy(iso: string | null): string;
export function dateTimeCopy(iso: string | null): string;
export function selfPacedCounts(monitor: Monitor | null): Record<SelfPacedState, number>;
export function canAddTime(student: MonitorStudent | null | undefined): boolean;
export function normalizeRoster(value: unknown): Map<string, RosterEntry> | null;
export function candidateRows(monitor: Monitor | null, audienceItems: { userId: string | null; source: string; skills: Skill[] }[] | null, roster: Map<string, RosterEntry> | null): CandidateRow[];
export function retestFlagsBody(allowed: Skill[], ticked: Skill[]): { retest_flags: Record<string, boolean> };
export function makeupTargets(rows: OrgExam[] | null, examId: string): OrgExam[];
export function normalizeEvents(value: unknown): RecordEvent[] | null;
