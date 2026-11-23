export type Skill = 'listening' | 'reading' | 'writing' | 'speaking';
export type ExamMode = 'live' | 'self_paced';
export type DisplayState = 'draft' | 'scheduled' | 'open' | 'running' | 'grading' | 'released' | 'ended' | 'archived';
export type SetupStepId = 'papers' | 'audience' | 'mode' | 'review';

export type OrgExam = {
  id: string;
  title: string;
  status: 'draft' | 'published' | 'archived';
  mode: ExamMode;
  state: DisplayState | null;
  skills: Skill[];
  audienceCount: number | null;
  listeningSeconds: number | null;
  startsAt: string | null;
  openFrom: string | null;
  openUntil: string | null;
  createdAt: string | null;
  listeningTestId: string | null;
  readingTestId: string | null;
  writingTask1PromptId: string | null;
  writingTask2PromptId: string | null;
  hasSpeakingPaper: boolean;
  readingMinutes: number;
  writingMinutes: number;
  allowEarlyAdvance: boolean;
  draftStep: SetupStepId | null;
};

export type SetupForm = {
  title: string;
  skills: Skill[];
  listeningTestId: string;
  readingTestId: string;
  writingTask1PromptId: string;
  writingTask2PromptId: string;
  mode: ExamMode;
  startsAt: string;
  openFrom: string;
  openUntil: string;
  allowEarlyAdvance: boolean;
};

export type AudienceItem = {
  studentId: string;
  userId: string | null;
  name: string;
  source: string;
  sourceKind: 'cohort' | 'learner' | 'group';
  skills: Skill[];
  selected: boolean;
  note: string | null;
};

export type Audience = { items: AudienceItem[]; mirrorFailed: boolean };
export type Built = { ok: true; value: Record<string, unknown> } | { ok: false; error: string };

export const SKILLS: readonly Skill[];
export const SKILL_NAMES: Readonly<Record<Skill, string>>;
export const STATE_LABELS: Readonly<Record<DisplayState, string>>;
export const LIST_FILTERS: readonly { id: string; label: string; states: DisplayState[] | null }[];
export const MODE_LABELS: Readonly<Record<ExamMode, string>>;
export const SETUP_STEPS: readonly { id: SetupStepId; label: string }[];

export function normalizeOrgExam(raw: unknown): OrgExam | null;
export function normalizeOrgExamList(value: unknown): { rows: OrgExam[]; malformed: number } | null;
export function filterOrgExams(rows: OrgExam[], filterId: string): OrgExam[];
export function filterCounts(rows: OrgExam[]): Record<string, number>;
export function stateLabel(state: DisplayState | null): string;
export function skillLetters(skills: Skill[]): string;
export function vnDateTime(value: string | null | undefined): string | null;
export function whenCopy(exam: OrgExam): string;
export function audienceCopy(exam: OrgExam): string;
export function nextStepCopy(exam: OrgExam): string;
export function examHref(exam: OrgExam): string;
export function setupStep(value: unknown): SetupStepId;
export function formFromExam(exam: OrgExam | null): SetupForm;
export function isoToVnLocal(value: string | null | undefined): string;
export function vnLocalToIso(value: string | null | undefined): string | null;
export function toggleSkill(skills: Skill[], skill: Skill): Skill[];
export function newExamCode(now?: number, random?: () => number): string;
export function buildCreateBody(form: SetupForm, code: string, step?: SetupStepId): Built;
export function buildPatchBody(form: SetupForm, exam: OrgExam, step: SetupStepId | null): Built;
export const LISTENING_BUFFER_SECONDS: number;
export function sittingMinutes(exam: OrgExam | null, skills: Skill[], listeningSeconds?: number | null): number;
export function modeLine(form: SetupForm, exam: OrgExam | null, listeningSeconds?: number | null): string | null;
export function normalizeAudience(value: unknown): Audience | null;
export function audienceSummary(items: AudienceItem[]): { selected: number; total: number; line: string | null; unselected: number };
export function audienceNote(item: AudienceItem): string | null;
export function missingCopy(code: string): string;
export function scheduleMissing(exam: OrgExam | null, audience: Audience | null): string[];
export function notReadyMissing(error: unknown): string[] | null;
