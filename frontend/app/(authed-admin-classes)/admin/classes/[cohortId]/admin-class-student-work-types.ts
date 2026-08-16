export type StudentWorkSubject = {
  student_id: string;
  name: string;
  student_code: string | null;
  user_id: string | null;
};

export type StudentWorkItem = {
  assignment_id: string;
  title: string;
  skill: 'speaking' | 'reading' | 'listening' | 'course';
  due_at: string | null;
  created_at: string | null;
  archived: boolean;
  status: string;
  submitted_at: string | null;
  score: number | null;
  artifact_kind: string | null;
  artifact_id: string | null;
  has_writing: boolean;
  bank_id: string | null;
};

export type StudentWorkPayload = {
  student: { id: string; name: string; student_code: string | null; activated: boolean };
  items: StudentWorkItem[];
  discarded_item_count: number;
  homework_stale: boolean;
};
