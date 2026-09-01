export type Student = {
  id: string;
  student_code: string;
  full_name: string;
  user_id: string | null;
  cohort_id: string | null;
  cohort_name: string | null;
  cohort_lookup_failed: boolean;
  membership_lookup_failed: boolean;
  cohorts: Array<{ id: string; name: string | null; is_primary: boolean }>;
  target_band: number | null;
  current_band_estimate: number | null;
  target_date: string | null;
  persona_notes: string | null;
  essay_history?: Array<Record<string, unknown>>;
  listening?: Record<string, unknown> | null;
  [key: string]: unknown;
};

export type CohortOption = { id: string; name: string; is_active: boolean };

export type StudentDraft = {
  id: string | null;
  studentCode: string;
  fullName: string;
  targetBand: string;
  currentBand: string;
  targetDate: string;
  notes: string;
  error: string;
};

export type Banner = null | { kind: 'success' | 'error'; text: string };

export type ProfileState = {
  id: string;
  fallback: Student;
  detail: Student | null;
  writing: Record<string, unknown> | null;
  errors: string[];
  loading: boolean;
};
