export type Course = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
};

export type Cohort = {
  id: string;
  name: string;
  code_prefix: string | null;
  description: string | null;
  course_id: string | null;
  is_active: boolean;
};

export type Member = {
  student_id: string;
  student_code: string | null;
  name: string;
  user_id: string | null;
  sessions: number | null;
  last_active: string | null;
  ai_cost_usd: number | null;
};

export type RosterPayload = {
  cohort: Cohort;
  member_count: number;
  discarded_member_count: number;
  members: Member[];
};

export type SkillProgress = {
  attempts: number;
  last_activity: string | null;
  last_band: number | null;
  recent_bands: number[];
};

export type HomeworkProgress = {
  assigned: number;
  submitted: number;
  late: number;
  missing: number;
  on_time_pct: number | null;
};

export type ProgressRow = {
  student_id: string;
  student_code: string | null;
  name: string;
  activated: boolean;
  target_band: number | null;
  skills: Record<'speaking' | 'writing' | 'reading' | 'listening', SkillProgress | null>;
  homework: HomeworkProgress | null;
};

export type ProgressPayload = { students: ProgressRow[]; degraded: string[] };

export type Attachment = { label: string; url: string; is_safe?: boolean };

export type Lesson = {
  id: string;
  title: string;
  lesson_no: number | null;
  lesson_date: string | null;
  body_md: string | null;
  attachments: Attachment[];
  is_published: boolean;
  created_at: string | null;
  updated_at: string | null;
};

export type LessonDraft = {
  id: string | null;
  title: string;
  lessonNo: string;
  lessonDate: string;
  body: string;
  attachments: Attachment[];
  attachmentsTouched: boolean;
  isPublished: boolean;
  error: string;
};

export type StudentOption = {
  id: string;
  student_code: string;
  full_name: string;
  cohort_id: string | null;
  cohort_name: string | null;
  cohorts: Array<{ id: string; name: string | null; is_primary: boolean }>;
  membership_lookup_failed: boolean;
  cohort_lookup_failed: boolean;
};

export type Banner = null | { kind: 'success' | 'error'; text: string };
export type DetailTab = 'roster' | 'progress' | 'lessons' | 'homework';
