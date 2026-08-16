export type Course = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  sort_order: number;
};

export type Cohort = {
  id: string;
  name: string;
  code_prefix: string | null;
  description: string | null;
  course_id: string | null;
  course: Course | null;
  member_count: number | null;
  unactivated_count: number | null;
  is_active: boolean;
  created_at: string | null;
  updated_at: string | null;
};

export type CohortPayload = {
  cohorts: Cohort[];
  rollup_failed: boolean;
  course_lookup_failed: boolean;
};

export type CohortDraft = {
  id: string | null;
  name: string;
  codePrefix: string;
  description: string;
  courseId: string;
  error: string;
};

export type Banner = null | { kind: 'success' | 'error'; text: string };
