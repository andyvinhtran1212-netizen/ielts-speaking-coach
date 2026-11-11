/**
 * In-memory implementation of contract v1 over the synthetic fixtures in
 * tests/fixtures/exercise-book/ (contract §7). It is used by the React tests
 * and by `next dev`; deployed builds never bind it (see client.ts).
 *
 * The mock keeps the server rules E depends on, so the UI is exercised against
 * them: create is idempotent per request_id + fingerprint, locked activities
 * are refused, save ACKs echo client_seq, submit compares expected_answers,
 * start returns the in-progress attempt, and grants refuse self-grant and a
 * repeat of the current state. Fixture data is fake (FR-024).
 */
import catalogFixture from '@/tests/fixtures/exercise-book/catalog.json';
import receiptFixture from '@/tests/fixtures/exercise-book/assignment-receipt.json';
import archivedFixture from '@/tests/fixtures/exercise-book/assignment-receipt-archived.json';
import assignmentsFixture from '@/tests/fixtures/exercise-book/assignments-page.json';
import progressFixture from '@/tests/fixtures/exercise-book/progress.json';
import learnerFixture from '@/tests/fixtures/exercise-book/learner-assignments.json';
import playerTextFixture from '@/tests/fixtures/exercise-book/player-text.json';
import playerKeepChangeFixture from '@/tests/fixtures/exercise-book/player-keep-change.json';
import inProgressFixture from '@/tests/fixtures/exercise-book/in-progress.json';
import reviewTextFixture from '@/tests/fixtures/exercise-book/review-text.json';
import reviewKeepChangeFixture from '@/tests/fixtures/exercise-book/review-keep-change.json';
import grantsFixture from '@/tests/fixtures/exercise-book/grants.json';
import grantsEmptyFixture from '@/tests/fixtures/exercise-book/grants-empty.json';
import grantLogFixture from '@/tests/fixtures/exercise-book/grant-log.json';
import errorsFixture from '@/tests/fixtures/exercise-book/errors.json';
import idsFixture from '@/tests/fixtures/exercise-book/ids.json';

import type {
  ActivityReview,
  AssignmentProgress,
  AssignmentReceipt,
  AssignmentSummary,
  AttemptState,
  ExerciseBookApi,
  Grant,
  GrantList,
  GrantLogEntry,
  LearnerAssignment,
  Page,
  PageQuery,
  Player,
  ReviewItem,
  SourceCatalog,
} from './contract';
import { toExerciseBookError } from './http-api';

export const MOCK_IDS = idsFixture;

type ErrorName = Exclude<keyof typeof errorsFixture, '_note'>;
export type MockMethod = keyof ExerciseBookApi;

export interface MockOptions {
  /** Force a contract error for a method; return undefined to run normally. */
  fail?: (method: MockMethod, args: unknown[]) => ErrorName | undefined;
  grants?: 'empty' | 'populated';
  /** The JWT subject the mock treats as the caller (grant page actor). */
  actorId?: string;
  now?: () => Date;
}

const clone = <T>(value: T): T => (value === undefined ? value : JSON.parse(JSON.stringify(value)) as T);

/** Throw exactly what the HTTP adapter would throw for this fixed body. */
export function mockError(name: ErrorName) {
  const fixture = errorsFixture[name] as { status: number; body: { detail: string; code?: string } };
  return toExerciseBookError({ status: fixture.status, detail: fixture.body.detail, code: fixture.body.code });
}

function paginate<T>(items: T[], page: PageQuery | undefined): Page<T> {
  const limit = Math.min(Math.max(page?.limit || 50, 1), 200);
  const start = page?.cursor ? Number(page.cursor) || 0 : 0;
  const slice = items.slice(start, start + limit);
  return { items: slice, next_cursor: start + limit < items.length ? String(start + limit) : null };
}

function uuid(seed: number) {
  return `00000000-0000-4000-8000-${String(seed).padStart(12, '0')}`;
}

export function createMockExerciseBookApi(options: MockOptions = {}): ExerciseBookApi {
  const now = options.now || (() => new Date());
  const actorId = options.actorId || idsFixture.owner_actor;
  const catalog = clone(catalogFixture) as SourceCatalog;
  const receipts = new Map<string, AssignmentReceipt>([
    [receiptFixture.assignment_id, clone(receiptFixture) as AssignmentReceipt],
    [archivedFixture.assignment_id, clone(archivedFixture) as AssignmentReceipt],
  ]);
  const summaries = clone(assignmentsFixture.items) as AssignmentSummary[];
  const fingerprints = new Map<string, string>();
  const learner = clone(learnerFixture.items) as LearnerAssignment[];
  const attempts = new Map<string, AttemptState>();
  const submittedReviews = new Map<string, ActivityReview>();
  let seed = 500;

  const reviewText = clone(reviewTextFixture) as ActivityReview;
  const reviewKeepChange = clone(reviewKeepChangeFixture) as ActivityReview;
  submittedReviews.set(reviewText.attempt.attempt_id, reviewText);
  submittedReviews.set(reviewKeepChange.attempt.attempt_id, reviewKeepChange);
  attempts.set(reviewText.attempt.attempt_id, reviewText.attempt);
  attempts.set(reviewKeepChange.attempt.attempt_id, reviewKeepChange.attempt);
  const seeded = clone(inProgressFixture.attempt) as AttemptState;
  attempts.set(seeded.attempt_id, seeded);

  let grants = clone(options.grants === 'empty' ? grantsEmptyFixture.grants : grantsFixture.grants) as Grant[];
  const grantLog = clone(options.grants === 'empty' ? [] : grantLogFixture.items) as GrantLogEntry[];
  const grantRequests = new Map<string, { body: string; ack: { event_id: string; seq: number; occurred_at: string } }>();

  async function run<T>(method: MockMethod, args: unknown[], body: () => T): Promise<T> {
    await Promise.resolve();
    const forced = options.fail?.(method, args);
    if (forced) throw mockError(forced);
    return clone(body());
  }

  function requireCohort(cohortId: string) {
    if (cohortId !== idsFixture.cohort) throw mockError('not_found');
  }

  function requireReceipt(cohortId: string, assignmentId: string) {
    requireCohort(cohortId);
    const receipt = receipts.get(assignmentId);
    if (!receipt) throw mockError('not_found');
    return receipt;
  }

  function activityByTest(testId: string) {
    const activity = catalog.inventory.activities.find((entry) => entry.test_id === testId);
    if (!activity) throw mockError('not_found');
    return activity;
  }

  function playerFor(testId: string): Player {
    if (testId === playerTextFixture.activity.test_id) return clone(playerTextFixture) as Player;
    if (testId === playerKeepChangeFixture.activity.test_id) return clone(playerKeepChangeFixture) as Player;
    const activity = activityByTest(testId);
    const { answer_set_revision: _hidden, ...binding } = activity.binding;
    return {
      activity: { ...clone(activity), binding },
      attempt: null,
      replay_policy: 'allowed',
      audio: clone(playerTextFixture.audio) as Player['audio'],
    };
  }

  function requireLearnerItem(classItem: string) {
    if (classItem !== idsFixture.learner_item) throw mockError('not_found');
  }

  function inProgressFor(testId: string, classItem: string) {
    for (const attempt of attempts.values()) {
      if (attempt.test_id === testId && attempt.context.class_assignment_item_id === classItem && attempt.status === 'in_progress') return attempt;
    }
    return null;
  }

  function requireAttempt(attemptId: string) {
    const attempt = attempts.get(attemptId);
    if (!attempt) throw mockError('not_found');
    return attempt;
  }

  function setLearnerStatus(testId: string, status: 'in_progress' | 'submitted', attemptId: string) {
    for (const assignment of learner) {
      for (const activity of assignment.activities) {
        if (activity.test_id === testId) { activity.my_status = status; activity.latest_attempt_id = attemptId; }
      }
    }
  }

  function reviewFor(attempt: AttemptState): ActivityReview {
    const player = playerFor(attempt.test_id);
    const template = attempt.test_id === reviewKeepChange.attempt.test_id ? reviewKeepChange : reviewText;
    const items: ReviewItem[] = player.activity.items.map((item) => {
      const saved = attempt.answers.find((answer) => answer.q_num === item.q_num)?.user_answer || '';
      const base = template.items.find((entry) => entry.q_num === item.q_num) || template.items[template.items.length - 1];
      return { ...base, source_item_id: item.source_item_id, q_num: item.q_num, saved_response: saved, blank: !saved.trim() };
    });
    return { attempt, items, transcript: template.transcript, audio: template.audio };
  }

  return {
    getCatalog: (cohortId) => run('getCatalog', [cohortId], () => { requireCohort(cohortId); return catalog; }),

    createAssignment: (cohortId, body) => run('createAssignment', [cohortId, body], () => {
      requireCohort(cohortId);
      const { request_id: requestId, ...rest } = body;
      const fingerprint = JSON.stringify(rest);
      const existing = receipts.get(requestId);
      if (existing) {
        if (fingerprints.get(requestId) !== fingerprint) throw mockError('idempotency_conflict');
        return existing;
      }
      if (!body.activities.length || body.activities.length > 17 || !body.recipient_ids.length || body.recipient_ids.length > 500) throw mockError('validation');
      if (body.activities.length * body.recipient_ids.length > 8500) throw mockError('validation');
      const due = Date.parse(body.due_at);
      if (!Number.isFinite(due) || due <= now().getTime() || due > now().getTime() + 180 * 86_400_000) throw mockError('validation');
      const recipients = new Set(catalog.eligible_recipients.map((entry) => entry.student_id));
      if (body.recipient_ids.some((id) => !recipients.has(id))) throw mockError('validation');
      for (const binding of body.activities) {
        const activity = catalog.inventory.activities.find((entry) => entry.binding.activity_id === binding.activity_id);
        if (!activity) throw mockError('validation');
        if (!activity.selectable) throw mockError('activity_locked');
        if (JSON.stringify(activity.binding) !== JSON.stringify(binding)) throw mockError('stale_revision');
      }
      const receipt: AssignmentReceipt = {
        assignment_id: requestId,
        request_id: requestId,
        cohort_id: cohortId,
        activities: body.activities,
        recipient_ids: body.recipient_ids,
        due_at: body.due_at,
        deadline_timezone: 'Asia/Ho_Chi_Minh',
        replay_policy: 'allowed',
        completion_denominator: body.activities.length,
        status: 'published',
        created_at: now().toISOString(),
      };
      receipts.set(requestId, receipt);
      fingerprints.set(requestId, fingerprint);
      summaries.unshift({
        assignment_id: requestId,
        title: `Black Eye · Unit 1 · ${body.activities.map((entry) => entry.activity_id.replace('U1-', '')).join(', ')}`,
        status: 'published',
        due_at: body.due_at,
        activity_count: body.activities.length,
        recipient_count: body.recipient_ids.length,
        created_at: receipt.created_at,
      });
      return receipt;
    }),

    listAssignments: (cohortId, page) => run('listAssignments', [cohortId, page], () => { requireCohort(cohortId); return paginate(summaries, page); }),

    getAssignment: (cohortId, assignmentId) => run('getAssignment', [cohortId, assignmentId], () => requireReceipt(cohortId, assignmentId)),

    archiveAssignment: (cohortId, assignmentId, body) => run('archiveAssignment', [cohortId, assignmentId, body], () => {
      const receipt = requireReceipt(cohortId, assignmentId);
      const reason = body.reason.trim();
      if (body.status !== 'archived' || !reason || reason.length > 500) throw mockError('validation');
      if (receipt.status === 'archived') throw mockError('conflict');
      receipt.status = 'archived';
      const summary = summaries.find((entry) => entry.assignment_id === assignmentId);
      if (summary) summary.status = 'archived';
      return receipt;
    }),

    getProgress: (cohortId, assignmentId) => run('getProgress', [cohortId, assignmentId], () => {
      const receipt = requireReceipt(cohortId, assignmentId);
      if (assignmentId === progressFixture.assignment_id) return progressFixture as AssignmentProgress;
      const students = catalog.eligible_recipients
        .filter((entry) => receipt.recipient_ids.includes(entry.student_id))
        .map((entry, index) => ({ ...entry, item_id: uuid(600 + index) }));
      const progress: AssignmentProgress = {
        assignment_id: assignmentId,
        cohort_id: cohortId,
        activities: receipt.activities.map((binding, index) => ({
          activity_key: binding.activity_id,
          test_id: catalog.inventory.activities.find((entry) => entry.binding.activity_id === binding.activity_id)?.test_id || '',
          position: index + 1,
        })),
        students,
        cells: students.flatMap((student) => receipt.activities.map((binding) => ({
          student_id: student.student_id,
          activity_id: binding.activity_id,
          item_id: student.item_id,
          attempt_id: null,
          status: 'not_started' as const,
          submitted_at: null,
          blank_count: null,
        }))),
        completion: { denominator: receipt.completion_denominator, submitted_by_student: Object.fromEntries(students.map((entry) => [entry.student_id, 0])) },
        dictation: { available: false, reason: 'separate_release_required' },
      };
      return progress;
    }),

    getTeacherReview: (cohortId, assignmentId, itemId, activityId) => run('getTeacherReview', [cohortId, assignmentId, itemId, activityId], () => {
      requireReceipt(cohortId, assignmentId);
      const progress = progressFixture as AssignmentProgress;
      const cell = progress.cells.find((entry) => entry.item_id === itemId && entry.activity_id === activityId);
      if (!cell) throw mockError('not_found');
      if (cell.status !== 'submitted') throw mockError('conflict');
      return activityId === reviewKeepChange.attempt.binding.activity_id ? reviewKeepChange : reviewText;
    }),

    listMyAssignments: (page) => run('listMyAssignments', [page], () => paginate(learner, page)),

    getPlayer: (testId, classItem) => run('getPlayer', [testId, classItem], () => {
      requireLearnerItem(classItem);
      const player = playerFor(testId);
      player.attempt = inProgressFor(testId, classItem);
      return player;
    }),

    getInProgress: (testId, classItem) => run('getInProgress', [testId, classItem], () => {
      requireLearnerItem(classItem);
      activityByTest(testId);
      return { attempt: inProgressFor(testId, classItem) };
    }),

    startAttempt: (testId, classItem, binding) => run('startAttempt', [testId, classItem, binding], () => {
      requireLearnerItem(classItem);
      const activity = activityByTest(testId);
      if (!activity.selectable) throw mockError('activity_locked');
      const { answer_set_revision: _hidden, ...expected } = activity.binding;
      if (JSON.stringify(expected) !== JSON.stringify(binding)) throw mockError('stale_revision');
      const current = inProgressFor(testId, classItem);
      if (current) return current;
      const attempt: AttemptState = {
        attempt_id: uuid(++seed),
        test_id: testId,
        binding,
        context: { kind: 'assigned', class_assignment_item_id: classItem, assignment_id: idsFixture.assignment, cohort_id: idsFixture.cohort },
        status: 'in_progress',
        answers: [],
        submitted_at: null,
        result_summary: null,
      };
      attempts.set(attempt.attempt_id, attempt);
      setLearnerStatus(testId, 'in_progress', attempt.attempt_id);
      return attempt;
    }),

    saveAnswer: (attemptId, body) => run('saveAnswer', [attemptId, body], () => {
      const attempt = requireAttempt(attemptId);
      if (attempt.status !== 'in_progress') throw mockError('attempt_changed');
      const item = playerFor(attempt.test_id).activity.items.find((entry) => entry.q_num === body.q_num);
      if (!item || body.user_answer.length > 2000) throw mockError('validation');
      const others = attempt.answers.filter((answer) => answer.q_num !== body.q_num);
      attempt.answers = [...others, { q_num: body.q_num, source_item_id: item.source_item_id, user_answer: body.user_answer }]
        .sort((left, right) => left.q_num - right.q_num);
      return { attempt_id: attemptId, answer_count: attempt.answers.length, performance_event_recorded: false, client_seq: body.client_seq };
    }),

    submitAttempt: (attemptId, body) => run('submitAttempt', [attemptId, body], () => {
      const attempt = requireAttempt(attemptId);
      if (attempt.status !== 'in_progress') throw mockError('attempt_changed');
      const items = playerFor(attempt.test_id).activity.items;
      const stored = (q: number) => attempt.answers.find((answer) => answer.q_num === q)?.user_answer || '';
      const expected = (q: number) => body.expected_answers.find((answer) => answer.q_num === q)?.user_answer || '';
      if (items.some((item) => stored(item.q_num) !== expected(item.q_num))) throw mockError('attempt_changed');
      const blanks = items.filter((item) => !stored(item.q_num).trim()).length;
      if (blanks && !body.confirm_blank) throw mockError('validation');
      attempt.status = 'submitted';
      attempt.submitted_at = now().toISOString();
      attempt.result_summary = {
        submitted: true, item_count: items.length, blank_count: blanks, unscored_count: items.length,
        objective_denominator: 0, score: null, band_estimate: null,
      };
      submittedReviews.set(attemptId, reviewFor(attempt));
      setLearnerStatus(attempt.test_id, 'submitted', attemptId);
      return attempt;
    }),

    getAttempt: (attemptId) => run('getAttempt', [attemptId], () => requireAttempt(attemptId)),

    playbackStarted: (attemptId) => run('playbackStarted', [attemptId], () => { requireAttempt(attemptId); }),

    getReview: (attemptId) => run('getReview', [attemptId], () => {
      const attempt = requireAttempt(attemptId);
      if (attempt.status !== 'submitted') throw mockError('conflict');
      return submittedReviews.get(attemptId) || reviewFor(attempt);
    }),

    getGrants: (cohortId) => run('getGrants', [cohortId], () => {
      requireCohort(cohortId);
      if (actorId !== idsFixture.owner_actor) throw mockError('not_owner');
      return { cohort_id: cohortId, grants } satisfies GrantList;
    }),

    recordGrant: (cohortId, body) => run('recordGrant', [cohortId, body], () => {
      requireCohort(cohortId);
      if (actorId !== idsFixture.owner_actor) throw mockError('not_owner');
      const serialized = JSON.stringify(body);
      const replay = grantRequests.get(body.request_id);
      if (replay) {
        if (replay.body !== serialized) throw mockError('idempotency_conflict');
        return replay.ack;
      }
      const reason = body.reason.trim();
      if (!reason || reason.length > 1000 || body.grantee_id === actorId) throw mockError('validation');
      const current = grants.find((entry) => entry.grantee_id === body.grantee_id && entry.role === body.role);
      const nextState = body.action === 'grant' ? 'granted' : 'revoked';
      if ((current?.state || 'revoked') === nextState) throw mockError('conflict');
      const seq = Math.max(0, ...grantLog.map((entry) => entry.seq)) + 1;
      const ack = { event_id: uuid(800 + seq), seq, occurred_at: now().toISOString() };
      grantLog.unshift({
        event_id: ack.event_id, seq, actor_id: actorId, grantee_id: body.grantee_id, role: body.role,
        action: body.action, occurred_at: ack.occurred_at, reason, request_id: body.request_id,
      });
      const updated: Grant = {
        grantee_id: body.grantee_id,
        display_name: current?.display_name || 'Nhân sự giả',
        role: body.role,
        state: nextState,
        last_event_seq: seq,
        last_event_at: ack.occurred_at,
      };
      grants = current ? grants.map((entry) => (entry === current ? updated : entry)) : [...grants, updated];
      grantRequests.set(body.request_id, { body: serialized, ack });
      return ack;
    }),

    getGrantLog: (cohortId, page) => run('getGrantLog', [cohortId, page], () => {
      requireCohort(cohortId);
      if (actorId !== idsFixture.owner_actor) throw mockError('not_owner');
      return paginate(grantLog, page);
    }),
  };
}

/** Every fixed error body of the fixture, for tests that walk them all. */
export const MOCK_ERROR_NAMES = Object.keys(errorsFixture).filter((key) => key !== '_note') as ErrorName[];
