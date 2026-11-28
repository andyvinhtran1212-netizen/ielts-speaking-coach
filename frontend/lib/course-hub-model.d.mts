export type CourseOnlineRow = {
  code: string; slug: string | null; title: string; expired: boolean; daysLeft: number | null;
  canRenew: boolean; progress: { done: number; total: number } | null; creditsLeft: number | null;
};
export type CourseOther = { slug: string; title: string; comingSoon: boolean };
export type CourseClass = {
  name: string | null; teacher: string | null; courseTitle: string | null;
  repractice: Array<{ code: string; title: string }>;
};
export type CourseHub = {
  online: CourseOnlineRow[];
  others: CourseOther[];
  klass: CourseClass | null;
  assignedOpen: number;
  hasClass: boolean;
  selected: string | null;
  degraded: Set<string>;
};
export type CourseLesson = { code: string; no: number | null; title: string; state: string; gate: string | null };
export type CourseLessons = {
  comingSoon: boolean;
  stages: Array<{ no: number | null; title: string | null; lessons: CourseLesson[] }>;
};

export function normalizeCourse(value: unknown): CourseHub | null;
export function shouldRedirectToAssigned(course: CourseHub): boolean;
export function assignedCardLabel(count: number): string;
export function onlineMeta(row: CourseOnlineRow): string;
export function classMeta(klass: CourseClass): string;
export function selectedCourse(course: CourseHub, requested: string | null): string | null;
export function lessonStateCopy(state: string): string | null;
export function normalizeLessons(value: unknown): CourseLessons | null;
export function lessonsFailure(caught: unknown): 'expired' | 'soon' | 'error';
