export type TodayState = 'learning' | 'first_day' | 'order_pending' | 'no_course';
export type TodayBanner = 'expiring' | 'expired' | 'out_of_credits';
export type TodayResume = {
  kind: 'speaking' | 'reading' | 'listening' | 'dictation';
  title: string; href: string; progress: { done: number; total: number } | null;
};
export type TodayResult = { kind: 'writing' | 'speaking'; title: string; href: string; key: string; returnedAt: string };
export type TodayGoal = { targetBand: number; weeksLeft: number | null };
export type TodayCredits = { total: number; rows: Array<{ kind: 'online' | 'class'; remaining: number }> };
export type TodayOrder = {
  code: string; status: 'awaiting_transfer' | 'transfer_reported' | 'needs_info';
  productTitle: string | null; supplementBy: string | null;
};
export type TodayRepeatError = { label: string; count: number; of: number; totalErrors: number; reviewHref: string | null };
export type TodayNextLesson = {
  courseName: string | null; stageNo: number | null; lessonNo: number | null; lessonCount: number | null;
  title: string; videoSeconds: number | null; practiceItems: number | null; resumeSeconds: number | null; href: string;
};
export type TodayMockExam = { title: string; href: string; state: string; closesAt: string | null };
export type Today = {
  name: string;
  state: TodayState;
  banner: TodayBanner | null;
  nextLesson: TodayNextLesson | null;
  assigned: unknown[];
  dueSoon: number;
  dueLater: number;
  resume: TodayResume[];
  credits: TodayCredits | null;
  orders: TodayOrder[];
  goal: TodayGoal | null;
  newResults: TodayResult[];
  seenCursor: { seen_until: string; seen_key: string } | null;
  repeatError: TodayRepeatError | null;
  trialTodayLeft: number | null;
  mockExams: TodayMockExam[];
  degraded: Set<string>;
};
export type CreditRow = { kind: 'online' | 'class' | 'total'; remaining: number; label: string };

export function safePath(value: unknown): string | null;
export function normalizeTodayResume(value: unknown): { resume: TodayResume[]; degraded: boolean } | null;
export function normalizeToday(value: unknown): Today | null;
export function todayCount(today: Today): number;
export function headingCopy(name: string, count: number): string;
export function goalCopy(goal: TodayGoal | null): string | null;
export function lessonActionCopy(lesson: TodayNextLesson): string;
export function minutesCopy(seconds: number | null): string | null;
export function creditRows(credits: TodayCredits | null): CreditRow[];
export function hasClassCredits(credits: TodayCredits | null): boolean;
export function orderStatusCopy(status: string): string | null;
export function vnDateCopy(value: unknown): string | null;
export function resumeKindCopy(kind: string): string;
export function assignedRows<R extends { isMissing?: boolean; assignment?: { dueAt?: string | null } }>(
  rows: Array<R | null>, now?: number,
): Array<{ row: R; overdue: boolean }>;
