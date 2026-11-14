'use client';

import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/lib/auth/auth-provider';
import { useExerciseBookApi } from '@/lib/exercise-book/api-context';
import type { LearnerActivityStatus, LearnerAssignment, LearnerAssignmentActivity } from '@/lib/exercise-book/contract';
import { errorText, formatVnTime, readinessText } from '@/lib/exercise-book/model';

import { reviewHref } from './exercise-book-runner';

const MY_STATUS: Record<LearnerActivityStatus, string> = {
  not_started: 'Chưa làm',
  in_progress: 'Đang làm',
  submitted: 'Đã nộp',
  expired: 'Quá hạn',
};

export const runnerHref = (activity: Pick<LearnerAssignmentActivity, 'test_id' | 'item_id'>) =>
  `/listening/exercise-book/tests/${encodeURIComponent(activity.test_id)}?class_item=${encodeURIComponent(activity.item_id)}`;

function ActivityRow({ activity, pastDue }: { activity: LearnerAssignmentActivity; pastDue: boolean }) {
  const reasonId = `exercise-book-reason-${activity.item_id}-${activity.activity_id}`;
  const locked = activity.readiness !== 'ready';
  const open = !locked && !pastDue && activity.my_status !== 'expired';
  const action = activity.my_status === 'in_progress' ? 'Làm tiếp' : activity.my_status === 'submitted' ? 'Làm lại' : 'Bắt đầu';
  return (
    <li className="programme-review-item">
      <h3>{activity.position}. {activity.title}</h3>
      <p>Trạng thái: {MY_STATUS[activity.my_status]}</p>
      {locked && <p id={reasonId}>{readinessText(activity.readiness_reasons)}</p>}
      {!locked && !open && <p id={reasonId}>Đã quá hạn nộp.</p>}
      {open
        ? <a className="programme-submit" href={runnerHref(activity)} style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center' }}>{action}</a>
        : <button type="button" disabled aria-describedby={reasonId} style={{ minHeight: 44 }}>{action}</button>}
      {activity.my_status === 'submitted' && activity.latest_attempt_id && (
        <a href={reviewHref(activity.latest_attempt_id)} style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', marginInlineStart: 12 }}>Xem tự đối chiếu</a>
      )}
    </li>
  );
}

function AssignmentCard({ assignment, now }: { assignment: LearnerAssignment; now: number }) {
  const due = Date.parse(assignment.due_at);
  const pastDue = Number.isFinite(due) && due <= now;
  // Locked activities do not count toward completion (QA G11).
  const countable = assignment.activities.filter((activity) => activity.readiness === 'ready');
  const done = countable.filter((activity) => activity.my_status === 'submitted').length;
  return (
    <section className="programme-result" aria-label={assignment.title}>
      <h2>{assignment.title}</h2>
      <p>Hạn nộp: {formatVnTime(assignment.due_at)}{pastDue ? ' · đã quá hạn' : ''}</p>
      <p>Đã nộp {done}/{countable.length} activity</p>
      <progress value={done} max={Math.max(countable.length, 1)} aria-label={`Đã nộp ${done} trên ${countable.length} activity`} />
      <ol style={{ listStyle: 'none', padding: 0 }}>
        {[...assignment.activities].sort((left, right) => left.position - right.position).map((activity) => (
          <ActivityRow key={activity.activity_id} activity={activity} pastDue={pastDue} />
        ))}
      </ol>
    </section>
  );
}

export function ExerciseBookAssignments() {
  const { status, user } = useAuth();
  if (status === 'signed-out') return <main className="programme-runner"><a href="/login">Đăng nhập để xem bài được giao</a></main>;
  if (status !== 'signed-in') return <main className="programme-runner"><p role="status">Đang kiểm tra đăng nhập…</p></main>;
  return <AssignmentsSession key={user?.id || ''} />;
}

function AssignmentsSession() {
  const api = useExerciseBookApi();
  const [items, setItems] = useState<LearnerAssignment[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(0);

  const load = useCallback(async (next: string | null) => {
    setBusy(true);
    setError('');
    try {
      const page = await api.listMyAssignments({ cursor: next });
      setNow(Date.now());
      setItems((current) => (next && current ? [...current, ...page.items] : page.items));
      setCursor(page.next_cursor);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }, [api]);

  useEffect(() => { void load(null); }, [load]);

  return (
    <main className="programme-runner">
      <header className="programme-runner__header">
        <h1>Sách bài tập được giao</h1>
        <p>Listening · tự đối chiếu sau khi nộp, không chấm điểm tự động</p>
      </header>
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button type="button" disabled={busy} onClick={() => void load(null)}>Thử lại</button>
        </div>
      )}
      {!items && !error && <p role="status">Đang tải bài được giao…</p>}
      {items && !items.length && <p>Bạn chưa được giao bài nào trong sách bài tập.</p>}
      {items?.map((assignment) => <AssignmentCard key={assignment.assignment_id} assignment={assignment} now={now} />)}
      {cursor && <button type="button" disabled={busy} onClick={() => void load(cursor)}>{busy ? 'Đang tải…' : 'Xem thêm'}</button>}
      <p><a href="/my-class">Về lớp học</a></p>
    </main>
  );
}
