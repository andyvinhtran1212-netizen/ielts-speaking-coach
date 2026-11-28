export type QueueKey =
  | 'exams_today' | 'writing_review' | 'speaking_mock_pending' | 'course_tests_awaiting_release'
  | 'assignments_overdue' | 'regrade_new' | 'enrollments_reported' | 'care_due_today'
  | 'incident_groups_open' | 'feedback_open' | 'entitlements_expiring' | 'classes_unmetered';
export type QueueRowDef = { key: QueueKey; label: string; href: string | null; onlyWhenActive?: boolean };
export type QueueState = {
  state: 'ok' | 'error' | 'unavailable';
  count: number | null;
  oldestAt: string | null;
  overdue: boolean;
  aiFailed: number | null;
};
export type Lesson = { id: string | null; no: number | null; date: string; startsAt: string | null };
export type ClassWeek = {
  id: string; name: string | null; next: Lesson; following: Lesson | null;
  hasAssignment: boolean; pendingReview: number; lastAssignmentId: string | null;
};
export type AttentionLearner = { ref: string; name: string; cohort: { id: string; name: string | null } | null; reasons: string[] };
export type Attention = {
  queues: Record<QueueKey, QueueState>;
  classes: ClassWeek[] | null;
  learners: AttentionLearner[] | null;
  ops: { onTimeRate: number | null; lowestCohortId: string | null; inactiveLearners: number | null; reviewWaitHours: number | null };
  thresholdsFailed: boolean;
  generatedAt: string | null;
};

export const QUEUE_ROWS: readonly QueueRowDef[];
export function liveHref(href: string | null): string | null;
export function normalizeAttention(raw: unknown): Attention | null;
export function visibleRows(data: Attention): QueueRowDef[];
export function summaryText(data: Attention): string;
export function dayText(date: Date): string;
export function timeText(date: Date): string;
export function waitedText(oldestAt: string | null, now?: Date): string | null;
export function lessonText(lesson: Lesson, now?: Date): string;
export function percentText(value: number): string;
export function hoursText(value: number): string;
