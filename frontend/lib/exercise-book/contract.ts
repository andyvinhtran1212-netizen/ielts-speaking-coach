/**
 * Exercise-book API v1 — hand-written types for the D ↔ E contract.
 *
 * Source: handoff/feature-developer/20261111-exercise-book-D-E-api-contract.md
 * (v1, frozen 11/11/2026 15:09 UTC+7). Field names, enums and error codes are
 * copied from that file; a change here needs the contract changelog line from
 * FD and Leader first. When PR D ships its routes, these types are replaced by
 * the generated `components['schemas']` from `types/api.d.ts`.
 *
 * Learner-facing types never carry `answer_set_revision`, references or
 * explanations before submit (FR-011, FR-013). Only the admin catalog, create
 * and receipt bindings carry `answer_set_revision`.
 */

export type Uuid = string;
/** ISO-8601 with offset; rendered in Asia/Ho_Chi_Minh (QA G16). */
export type Ts = string;

export type Readiness = 'locked' | 'candidate' | 'ready';

/** Learner binding: 7 fields, never `answer_set_revision` (§4). */
export interface LearnerBinding {
  programme_id: string;
  collection_id: string;
  source_contract: string;
  unit_id: string;
  activity_id: string;
  content_revision: string;
  policy_revision: string;
}

/** Admin binding: 8 fields, only in catalog/create/receipt (§1, FR-013). */
export interface RevisionBinding extends LearnerBinding {
  answer_set_revision: Uuid;
}

export type Interaction = 'text' | 'keep_change';

export interface PublicItem {
  source_item_id: string;
  q_num: number;
  source_display_number: string;
  interaction: Interaction;
  prompt: string;
  instruction: string;
  givens: string[];
  group_id: string | null;
  row_id: string | null;
  column_id: string | null;
}

export interface Dictation {
  available: false;
  reason: 'separate_release_required';
}

interface ActivityBase {
  test_id: Uuid | null;
  title: string;
  order: number;
  readiness: Readiness;
  readiness_reasons: string[];
  selectable: boolean;
  response_cell_count: number;
  scoring_policy: 'report_only';
  items: PublicItem[];
}

export interface ActivityAdmin extends ActivityBase {
  binding: RevisionBinding;
}

export interface ActivityPublic extends ActivityBase {
  binding: LearnerBinding;
}

// ---------------------------------------------------------------- §1 catalog

export interface Recipient {
  student_id: Uuid;
  display_name: string;
}

export interface SourceCatalog {
  inventory: { collection_id: string; unit_id: string; activities: ActivityAdmin[] };
  eligible_recipients: Recipient[];
  lookup_errors: string[];
}

// ---------------------------------------------------------- §2 assignments

export interface AssignmentCreate {
  request_id: Uuid;
  activities: RevisionBinding[];
  recipient_ids: Uuid[];
  due_at: Ts;
  deadline_timezone: 'Asia/Ho_Chi_Minh';
  replay_policy: 'allowed';
}

export type AssignmentStatus = 'published' | 'archived';

export interface AssignmentReceipt {
  assignment_id: Uuid;
  request_id: Uuid;
  cohort_id: Uuid;
  activities: RevisionBinding[];
  recipient_ids: Uuid[];
  due_at: Ts;
  deadline_timezone: 'Asia/Ho_Chi_Minh';
  replay_policy: 'allowed';
  completion_denominator: number;
  status: AssignmentStatus;
  created_at: Ts;
}

export interface AssignmentSummary {
  assignment_id: Uuid;
  title: string;
  status: AssignmentStatus;
  due_at: Ts;
  activity_count: number;
  recipient_count: number;
  created_at: Ts;
}

export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

export interface AssignmentArchive {
  status: 'archived';
  reason: string;
}

// ------------------------------------------------------------- §3 progress

export type CellStatus = 'not_started' | 'in_progress' | 'submitted' | 'expired' | 'unavailable';

export interface ProgressCell {
  student_id: Uuid;
  activity_id: string;
  item_id: Uuid;
  attempt_id: Uuid | null;
  status: CellStatus;
  submitted_at: Ts | null;
  blank_count: number | null;
}

/** No score, accuracy or `answer_set_revision` (FR-013, FR-018). */
export interface AssignmentProgress {
  assignment_id: Uuid;
  cohort_id: Uuid;
  activities: { activity_key: string; test_id: Uuid; position: number }[];
  students: { student_id: Uuid; display_name: string; item_id: Uuid }[];
  cells: ProgressCell[];
  completion: { denominator: number; submitted_by_student: Record<Uuid, number> };
  dictation: { available: boolean; reason: string };
}

// ------------------------------------------------------- §4 learner runner

export type LearnerActivityStatus = 'not_started' | 'in_progress' | 'submitted' | 'expired';

export interface LearnerAssignmentActivity {
  activity_id: string;
  title: string;
  position: number;
  test_id: Uuid;
  /** The learner's own `class_assignment_items.id`. */
  item_id: Uuid;
  readiness: 'ready' | 'locked';
  readiness_reasons: string[];
  my_status: LearnerActivityStatus;
  latest_attempt_id: Uuid | null;
}

export interface LearnerAssignment {
  assignment_id: Uuid;
  cohort_id: Uuid;
  title: string;
  due_at: Ts;
  status: 'published';
  activities: LearnerAssignmentActivity[];
}

export interface Answer {
  q_num: number;
  source_item_id: string;
  user_answer: string;
}

export interface AttemptContext {
  kind: 'standalone' | 'assigned';
  class_assignment_item_id: Uuid | null;
  assignment_id: Uuid | null;
  cohort_id: Uuid | null;
}

export interface ResultSummary {
  submitted: true;
  item_count: number;
  blank_count: number;
  unscored_count: number;
  objective_denominator: 0;
  score: null;
  band_estimate: null;
}

export interface AttemptState {
  attempt_id: Uuid;
  test_id: Uuid;
  binding: LearnerBinding;
  context: AttemptContext;
  status: 'in_progress' | 'submitted';
  answers: Answer[];
  submitted_at: Ts | null;
  result_summary: ResultSummary | null;
}

export interface ActivityAudio {
  url: string | null;
  granularity: 'whole_activity';
  expires_in: number | null;
}

export interface Player {
  activity: ActivityPublic;
  attempt: AttemptState | null;
  replay_policy: 'allowed';
  audio: ActivityAudio;
}

export interface InProgress {
  attempt: AttemptState | null;
}

export interface SaveAnswer {
  q_num: number;
  user_answer: string;
  /** Monotonic per attempt; the ACK echoes it so saves are matched by order (CR F01). */
  client_seq: number;
}

export interface SaveAck {
  attempt_id: Uuid;
  answer_count: number;
  performance_event_recorded: boolean;
  client_seq: number;
}

export interface SubmitBody {
  expected_answers: Answer[];
  confirm_blank: boolean;
}

export const KEEP_CHANGE_VERSION = 'blackeye_keep_change_v1';

/** `user_answer` of a keep_change cell is this object JSON-encoded. */
export interface KeepChange {
  version: typeof KEEP_CHANGE_VERSION;
  action: 'KEEP' | 'CHANGE' | null;
  correction_text: string;
}

// ------------------------------------------------------- §5 self-check review

export type SourceStatus = 'UNRESOLVED' | 'CONFIRMED' | 'DISAGREEMENT';
export type AcademicVerdict = 'CONFIRMED' | 'SUSPECT' | 'AMBIGUOUS' | 'UNRESOLVED';
export type ReferenceProvenance = 'literal_key' | 'derived' | 'editorial';
/** v1: Black Eye is SELF-CHECK only; "AUTO" is reserved for other books (v1.1). */
export type ScoringMode = 'SELF-CHECK';

export interface ReviewItem {
  source_item_id: string;
  q_num: number;
  saved_response: string;
  blank: boolean;
  source_status: SourceStatus;
  scoring_mode: ScoringMode;
  academic_verdict: AcademicVerdict;
  reference: string | string[] | { version: string; action: 'KEEP' | 'CHANGE'; correction_text: string } | null;
  reference_provenance: ReferenceProvenance;
  explanation_vi: string | null;
  limitation_vi: string | null;
  evidence_pointer: string | null;
}

export interface ActivityReview {
  attempt: AttemptState;
  items: ReviewItem[];
  transcript: { text: string; start: number | null; end: number | null }[];
  audio: ActivityAudio;
}

// --------------------------------------------------------- §6 course-2 grants

export type GrantRole = 'assigner' | 'teacher';
export type GrantAction = 'grant' | 'revoke';

export interface Grant {
  grantee_id: Uuid;
  display_name: string;
  role: GrantRole;
  state: 'granted' | 'revoked';
  last_event_seq: number;
  last_event_at: Ts;
}

export interface GrantList {
  cohort_id: Uuid;
  grants: Grant[];
}

export interface GrantEventCreate {
  grantee_id: Uuid;
  role: GrantRole;
  action: GrantAction;
  reason: string;
  request_id: Uuid;
}

export interface GrantEventAck {
  event_id: Uuid;
  seq: number;
  occurred_at: Ts;
}

export interface GrantLogEntry {
  event_id: Uuid;
  seq: number;
  actor_id: Uuid;
  grantee_id: Uuid;
  role: GrantRole;
  action: GrantAction;
  occurred_at: Ts;
  reason: string;
  request_id: Uuid;
}

// ------------------------------------------------------------------- errors

/** Fixed error codes of §0. The body never echoes client values. */
export type ErrorCode =
  | 'unauthenticated'
  | 'forbidden'
  | 'step_up_required'
  | 'not_owner'
  | 'not_found'
  | 'stale_revision'
  | 'idempotency_conflict'
  | 'attempt_changed'
  | 'conflict'
  | 'activity_locked'
  | 'past_due'
  | 'validation'
  | 'unavailable'
  | 'network';

export class ExerciseBookError extends Error {
  readonly status: number;
  readonly code: ErrorCode;

  constructor(status: number, code: ErrorCode) {
    // Only status and code: never a server message or a client value, so the
    // error is safe to show or report (FR-013, FR-026, SA F05).
    super(`exercise-book ${status} ${code}`);
    this.name = 'ExerciseBookError';
    this.status = status;
    this.code = code;
  }
}

export interface PageQuery {
  limit?: number;
  cursor?: string | null;
}

/**
 * Every route of contract v1 that PR E consumes. Components depend only on this
 * interface; `client.ts` decides which implementation backs it.
 */
export interface ExerciseBookApi {
  // §1–3 admin
  getCatalog(cohortId: Uuid): Promise<SourceCatalog>;
  createAssignment(cohortId: Uuid, body: AssignmentCreate): Promise<AssignmentReceipt>;
  listAssignments(cohortId: Uuid, page?: PageQuery): Promise<Page<AssignmentSummary>>;
  getAssignment(cohortId: Uuid, assignmentId: Uuid): Promise<AssignmentReceipt>;
  archiveAssignment(cohortId: Uuid, assignmentId: Uuid, body: AssignmentArchive): Promise<AssignmentReceipt>;
  getProgress(cohortId: Uuid, assignmentId: Uuid): Promise<AssignmentProgress>;
  getTeacherReview(cohortId: Uuid, assignmentId: Uuid, itemId: Uuid, activityId: string): Promise<ActivityReview>;
  // §4–5 learner
  listMyAssignments(page?: PageQuery): Promise<Page<LearnerAssignment>>;
  getPlayer(testId: Uuid, classItem: Uuid): Promise<Player>;
  getInProgress(testId: Uuid, classItem: Uuid): Promise<InProgress>;
  startAttempt(testId: Uuid, classItem: Uuid, binding: LearnerBinding): Promise<AttemptState>;
  saveAnswer(attemptId: Uuid, body: SaveAnswer): Promise<SaveAck>;
  submitAttempt(attemptId: Uuid, body: SubmitBody): Promise<AttemptState>;
  getAttempt(attemptId: Uuid): Promise<AttemptState>;
  playbackStarted(attemptId: Uuid): Promise<void>;
  getReview(attemptId: Uuid): Promise<ActivityReview>;
  // §6 grants
  getGrants(cohortId: Uuid): Promise<GrantList>;
  recordGrant(cohortId: Uuid, body: GrantEventCreate): Promise<GrantEventAck>;
  getGrantLog(cohortId: Uuid, page?: PageQuery): Promise<Page<GrantLogEntry>>;
}
