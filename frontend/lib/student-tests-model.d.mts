export type TestsSkill = 'listening' | 'reading' | 'writing' | 'speaking';
export type AssignedExam = {
  id: string; title: string; mode: 'live' | 'self_paced' | null;
  state: 'upcoming' | 'open' | 'submitted' | 'released' | 'closed_missed';
  opensAt: string | null; closesAt: string | null; skills: TestsSkill[] | null;
  totalMinutes: number | null; inProgress: boolean; href: string;
};
export type TestsResult = {
  kind: 'listening_full' | 'listening_mini' | 'reading_full' | 'reading_mini' | 'speaking_full' | 'writing_full' | 'mock';
  id: string; title: string; submittedAt: string;
  state: 'submitted' | 'grading' | 'reviewing' | 'released' | null;
  band: number | null; correct: number | null; total: number | null;
  overall: number | null; pendingSkills: TestsSkill[] | null; href: string;
};
export type StudentTests = {
  assigned: AssignedExam[];
  results: TestsResult[];
  nextCursor: string | null;
  credits: { total: number } | null;
  degraded: Set<'assigned_exams' | 'results' | 'credits'>;
};
export type SelfTest = { id: string; skill: TestsSkill; full: boolean; title: string; href: string };
export const FULL_TEST_CREDITS: Readonly<{ writing: number; speaking: number }>;
export const SELF_TESTS: ReadonlyArray<SelfTest>;
export function safePath(value: unknown): string | null;
export function normalizeStudentTests(value: unknown): StudentTests | null;
export function examStateLabel(state: string): string | null;
export function examModeLabel(mode: string | null): string | null;
export function examSkillsLine(list: TestsSkill[] | null): string | null;
export function examSelfPacedLine(exam: AssignedExam): string | null;
export function examAction(exam: AssignedExam): { label: string; href: string; fullTest: boolean } | null;
export function resultKindLabel(kind: string): string | null;
export function resultScoreCopy(row: TestsResult): string | null;
export function resultOverallCopy(row: TestsResult): string | null;
export function shortOfCredits(test: SelfTest, credits: { total: number } | null): boolean;
export function vnDateCopy(value: string | null): string | null;
export function vnDateTimeCopy(value: string | null): string | null;
