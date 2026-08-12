export type AssignmentProgress = {
  assigned: number;
  submitted: number;
  late: number;
  missing: number;
  no_account: number;
};

export type ClassAssignment = {
  id: string;
  title: string;
  skill: 'speaking' | 'reading' | 'listening' | 'course';
  kind: 'daily' | 'lesson';
  status: 'published' | 'archived';
  due_at: string | null;
  content_id: string | null;
  content_config: Record<string, unknown>;
  recipient_scope: 'class' | 'subset';
  created_at: string | null;
  progress: AssignmentProgress | null;
};

export type AssignmentPayload = {
  assignments: ClassAssignment[];
  reconcile_failed: boolean;
};

export type CatalogOption = {
  id: string;
  title: string;
  code: string | null;
  part: number | null;
  lesson_no: number | null;
  ready: boolean;
  already_given: boolean;
  reason: string | null;
};

export type QuestionOption = {
  id: string;
  text: string;
  ready: boolean;
  audio_url: string | null;
};

export type HomeworkDraft = {
  kind: 'daily' | 'lesson';
  skill: 'speaking' | 'reading' | 'listening' | 'course';
  title: string;
  contentId: string;
  mode: 'practice' | 'test_part';
  part: '1' | '2' | '3';
  questionMode: 'random' | 'manual';
  questionIds: string[];
  dueDate: string;
  dueTime: string;
  dueDays: string;
  instructions: string;
  recipientScope: 'class' | 'subset';
  studentIds: string[];
  passPct: string;
  retakeSize: string;
  error: string;
};

export type DueDraft = {
  assignment: ClassAssignment;
  dueDate: string;
  dueTime: string;
  confirmed: { date: string | null; time: string | null; flips: { to_ontime: number; to_late: number } } | null;
  warning: string;
  error: string;
};

export type ActionLogRow = {
  id: string;
  action: string;
  created_at: string | null;
  actor_email: string | null;
  assignment_title: string | null;
  student_name: string | null;
  details: Record<string, unknown>;
};

export type ActionLogPayload = {
  actions: ActionLogRow[];
  has_more: boolean;
  next_before: string | null;
};
