export type TeacherClass = {
  id: string;
  name: string;
  /** null: the backend could not count it ("chưa có"). */
  writingPending: number | null;
  writingOverdue: number | null;
  speakingMockPending: number | null;
};

export type InstructorMetric = {
  instructorId: string;
  email: string | null;
  displayName: string | null;
  students: number;
  prompts: number;
  graded: number;
  regraded: number;
  regradeEvents: number;
  tokens: number;
  costUsd: number;
  /** ADMINIA-0074 FR-106. null: unreadable. */
  classes: TeacherClass[] | null;
  writingPending: number | null;
  writingOverdue: number | null;
  delivered30d: number | null;
  inProgress: number | null;
  /** null below the backend's minimum of reviews: shown blank. */
  avgReviewHours: number | null;
};

export type InstructorsPayload = {
  rows: InstructorMetric[];
  malformedCount: number;
};

export type TeacherSortKey = 'name' | 'classes' | 'pending' | 'speed';
export type TeacherSort = { key: TeacherSortKey; dir: 'asc' | 'desc' };

export type CohortChoice = {
  id: string;
  name: string;
  teacherId: string | null;
  teacherName: string | null;
};
