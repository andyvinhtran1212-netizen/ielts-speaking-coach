'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useAuth } from '@/lib/auth/auth-provider';
import { admitCorePlayer } from '@/lib/core-player-affinity.mjs';
import {
  assignmentAction,
  assignmentSubtitle,
  awaitingWriting,
  isKnownPlayerSurface,
  nextDue,
  normalizeClassStartResponse,
  normalizeMyClassResponse,
  remainingLabel,
  rhythmDays,
} from '@/lib/my-class-model.mjs';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

type Assignment = {
  itemId: string;
  state: string;
  submittedAt: string | null;
  score: number | null;
  passedAt: string | null;
  writingExpected: boolean | null;
  isLate: boolean;
  isMissing: boolean;
  assignment: {
    id: string;
    title: string;
    skill: string;
    instructions: string | null;
    dueAt: string | null;
    content: {
      topic: string | null;
      mode: string | null;
      part: number | null;
      testTitle: string | null;
      lessonNo: number | null;
    };
  };
};

type Lesson = {
  id: string;
  title: string;
  lessonNo: number | null;
  lessonDate: string | null;
  bodyMarkdown: string;
  attachments: Array<{ label: string; url: string | null }>;
};

type ClassSnapshot = {
  hasClass: true;
  classInfo: { id: string | null; name: string | null; description: string | null;
    course: { code: string; name: string } | null } | null;
  assignments: Assignment[] | null;
  lessons: Lesson[] | null;
  progress: { total: number; submitted: number; todo: number; missing: number;
    late: number; onTimePct: number | null } | null;
  warnings: string[];
};

type Snapshot = { hasClass: false } | ClassSnapshot | null;

type StartTarget =
  | { kind: 'course'; bankId: string; itemId: string; reviewOnly: boolean }
  | { kind: 'player'; surface: string; query: Record<string, string> }
  | { kind: 'stable-player'; url: string }
  | { kind: 'admission'; url: string }
  | { kind: 'result'; url: string }
  | { kind: 'create-speaking'; body: {
      mode: string; part: number; topic: string; class_assignment_item_id: string;
    } };

const SKILL_LABEL: Record<string, string> = {
  speaking: 'Speaking', writing: 'Writing', reading: 'Reading',
  listening: 'Listening', course: 'Bài tập theo buổi',
};

const WARNING_COPY: Record<string, string> = {
  class: 'Chưa tải được thông tin lớp.',
  lessons: 'Chưa tải được buổi học.',
  assignments: 'Chưa tải được bài tập; không dùng các con số trên trang để kết luận bạn đã hết bài.',
  homework_stale: 'Bài bạn vừa nộp có thể chưa hiện ở đây. Nếu đã làm xong, không cần làm lại.',
  assignments_contract: 'Dữ liệu bài tập không đúng hợp đồng nên đã được ẩn để tránh hiển thị sai.',
  lessons_contract: 'Dữ liệu buổi học không đúng hợp đồng nên đã được ẩn.',
  progress_contract: 'Tổng quan không khớp danh sách bài tập nên các con số đã được ẩn.',
};

function formatDateTime(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleString('vi-VN', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

function dueLabel(value: string | null) {
  if (!value) return 'Không có hạn nộp';
  const formatted = formatDateTime(value);
  return formatted ? `Hạn ${formatted}` : 'Hạn nộp không đọc được';
}

function calendarDate(value: string | null) {
  if (!value) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
}

function submittedCopy(row: Assignment) {
  const prefix = row.isLate ? 'Nộp trễ lúc' : 'Đã nộp lúc';
  const score = row.score == null ? '' : row.assignment.skill === 'course'
    ? ` · ${Math.round(row.score)}%${row.passedAt ? ' · đã đạt' : ''}`
    : ` · Band ${row.score}`;
  return `${prefix} ${formatDateTime(row.submittedAt)}${score}`;
}

function Markdown({ value }: { value: string }) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    setHtml(null);
    void whenGlobalReady(
      () => typeof window.renderMarkdown === 'function',
      'window.renderMarkdown (My Class)',
    ).then((ready) => {
      if (!disposed && ready && window.renderMarkdown) {
        setHtml(window.renderMarkdown(value, { breaks: true }));
      }
    });
    return () => { disposed = true; };
  }, [value]);
  if (html == null) return <p>{value}</p>;
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

function TaskCard({
  row, starting, onStart,
}: { row: Assignment; starting: boolean; onStart: (row: Assignment) => void }) {
  const partial = awaitingWriting(row);
  const action = assignmentAction(row);
  const state = row.submittedAt ? 'done' : row.isMissing ? 'missing' : 'todo';
  const stateLabel = row.submittedAt ? (row.isLate ? 'Đã nộp trễ' : 'Đã nộp')
    : row.isMissing ? 'Đã quá hạn' : partial ? 'Còn phần tự luận' : 'Cần hoàn thành';
  const subtitle = assignmentSubtitle(row);

  return (
    <article className={`mc-item${row.isMissing ? ' is-missing' : ''}`}>
      <div className="mc-item-main">
        <div className="mc-item-meta">
          <span className="mc-item-kind">{SKILL_LABEL[row.assignment.skill]}</span>
          <span className="mc-item-state" data-state={state}>{stateLabel}</span>
        </div>
        <p className="mc-item-title">{row.assignment.title}</p>
        {subtitle && <p className="mc-item-sub">{subtitle}</p>}
        <p className={`mc-item-sub${row.isMissing ? ' is-alarm' : ''}`}>
          {row.submittedAt ? submittedCopy(row) : (
            <>
              {partial && <><span className="mc-partial">Chưa hoàn tất — còn phần tự luận</span> · </>}
              {dueLabel(row.assignment.dueAt)}{row.isMissing ? ' · quá hạn' : ''}
            </>
          )}
        </p>
        {row.assignment.instructions && (
          <p className="mc-item-sub">{row.assignment.instructions}</p>
        )}
      </div>
      {action && (
        <button
          className={`av-button ${action.kind === 'review' ? 'av-button-secondary' : 'av-button-primary'}`}
          type="button"
          disabled={starting}
          onClick={() => onStart(row)}
        >
          {starting ? 'Đang mở…' : action.label}
        </button>
      )}
    </article>
  );
}

function TaskGroup({
  title, rows, startingItem, onStart,
}: { title: string; rows: Assignment[]; startingItem: string | null; onStart: (row: Assignment) => void }) {
  if (!rows.length) return null;
  return (
    <section className="mc-group">
      <h2>{title}</h2>
      <div className="mc-list">
        {rows.map((row) => (
          <TaskCard
            key={row.itemId}
            row={row}
            starting={startingItem === row.itemId}
            onStart={onStart}
          />
        ))}
      </div>
    </section>
  );
}

function ClassRhythm({ assignments, now }: { assignments: Assignment[]; now: number }) {
  const days = rhythmDays(assignments, new Date(now));
  const active = days.filter((day: any) => day.state !== 'none');
  if (!active.length) return null;
  const kept = active.filter((day: any) => day.state === 'done' || day.state === 'late').length;
  const missed = active.filter((day: any) => day.state === 'missing').length;
  const labels: Record<string, string> = {
    none: 'không có bài', done: 'đã nộp', late: 'nộp trễ', missing: 'chưa nộp',
  };
  const marks: Record<string, string> = { none: '', done: '✓', late: '◐', missing: '✕' };
  return (
    <section className="mc-rhythm" aria-label="Nhịp nộp bài 14 ngày gần nhất">
      <span className="mc-rhythm__label">Nhịp 14 ngày</span>
      <span className="mc-rhythm__row">
        {days.map((day: any) => (
          <i
            key={day.day}
            data-s={day.state}
            data-today={day.today ? '' : undefined}
            title={`${day.day} — ${labels[day.state]}`}
          >
            {marks[day.state]}
          </i>
        ))}
      </span>
      <span className="mc-rhythm__note">
        {missed ? `${kept}/${active.length} buổi đã nộp · ${missed} buổi bỏ lỡ`
          : `${kept}/${active.length} buổi đã nộp — đang đều`}
      </span>
    </section>
  );
}

function Lessons({ lessons }: { lessons: Lesson[] | null }) {
  if (lessons == null) {
    return <section className="mc-lessons-panel"><div className="mc-empty" role="alert">Chưa đọc được nội dung buổi học.</div></section>;
  }
  if (!lessons.length) return null;
  return (
    <section className="mc-group mc-lessons-panel">
      <div className="mc-lessons-head"><p className="mc-kicker">Từ giảng viên</p><h2>Buổi học</h2></div>
      <div className="mc-list">
        {lessons.map((lesson) => (
          <article className="mc-lesson" key={lesson.id}>
            <div className="mc-lesson-no">{lesson.lessonNo != null ? `Buổi ${lesson.lessonNo}` : ''}</div>
            <div className="mc-lesson-main">
              <p className="mc-lesson-title">{lesson.title}</p>
              {calendarDate(lesson.lessonDate) && <p className="mc-item-sub">{calendarDate(lesson.lessonDate)}</p>}
              {lesson.bodyMarkdown && <div className="mc-lesson-body"><Markdown value={lesson.bodyMarkdown} /></div>}
              {lesson.attachments.length > 0 && (
                <div className="mc-files">
                  {lesson.attachments.map((file: any, index: number) => file.url ? (
                    <a className="mc-file" href={file.url} target="_blank" rel="noopener noreferrer" key={`${file.label}-${index}`}>
                      {file.label}
                    </a>
                  ) : (
                    <span className="mc-file" title="Đường dẫn không hợp lệ" key={`${file.label}-${index}`}>
                      {file.label}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function ReadyView({
  snapshot, now, refreshError, startingItem, onRetry, onStart,
}: {
  snapshot: ClassSnapshot;
  now: number;
  refreshError: string | null;
  startingItem: string | null;
  onRetry: () => void;
  onStart: (row: Assignment) => void;
}) {
  const assignments = snapshot.assignments;
  const due = assignments ? nextDue(assignments) : null;
  const left = due ? due.at - now : 0;
  const missing = assignments?.filter((row) => row.isMissing) || [];
  const todo = assignments?.filter((row) => !row.submittedAt && !row.isMissing) || [];
  const done = assignments?.filter((row) => row.submittedAt) || [];
  const course = snapshot.classInfo?.course;
  const warnings = snapshot.warnings.map((key: string) => WARNING_COPY[key] || `Một phần dữ liệu chưa sẵn sàng (${key}).`);
  if (refreshError) warnings.push(refreshError);
  const stats = snapshot.progress ? [
    { value: snapshot.progress.todo, label: 'Cần nộp' },
    { value: snapshot.progress.missing, label: 'Quá hạn', alarm: snapshot.progress.missing > 0 },
    { value: snapshot.progress.submitted, label: 'Đã nộp' },
    { value: snapshot.progress.onTimePct == null ? '—' : `${snapshot.progress.onTimePct}%`, label: 'Đúng hạn' },
  ] : [{ value: '—', label: 'Chưa đọc được bài tập' }];

  return (
    <>
      <header className="mc-hero">
        <div className="mc-head">
          <p className="mc-eyebrow">MY CLASS</p>
          <h1>{snapshot.classInfo?.name || 'Lớp của tôi'}</h1>
          {course && <div className="mc-course"><span className="mc-course-code">{course.code}</span>{course.name}</div>}
          <p className="mc-lead">Theo dõi việc cần làm, nhịp nộp bài và nội dung mới nhất từ lớp.</p>
        </div>
        <section className="mc-stats" aria-label="Tổng quan bài tập">
          {stats.map((stat) => (
            <div className={`mc-stat${stat.alarm ? ' is-alarm' : ''}`} key={stat.label}>
              <div className="mc-stat-num">{stat.value}</div><div className="mc-stat-label">{stat.label}</div>
            </div>
          ))}
        </section>
      </header>

      {warnings.length > 0 && (
        <div className="mc-warn" role="alert">
          <span>{warnings.join(' ')}</span>
          {refreshError && <button className="av-button av-button-secondary" type="button" onClick={onRetry}>Tải lại</button>}
        </div>
      )}

      {due && left > 0 && (
        <section className="mc-due-now">
          <div className="mc-due-now__task">
            <p className="mc-kicker">Ưu tiên tiếp theo</p>
            <h2>{due.row.assignment.title}</h2>
            <p className="mc-item-sub">{assignmentSubtitle(due.row)}</p>
          </div>
          <div className="mc-due-now__clock">
            <div className={`mc-countdown${left < 3600000 ? ' is-urgent' : ''}`} role="timer" aria-live="polite">
              {remainingLabel(left)}
            </div>
            <div className="mc-countdown-label">{dueLabel(due.row.assignment.dueAt)}</div>
          </div>
          <button
            className="av-button av-button-primary"
            type="button"
            disabled={startingItem === due.row.itemId}
            onClick={() => onStart(due.row)}
          >
            {startingItem === due.row.itemId ? 'Đang mở…' : 'Làm bài'}
          </button>
        </section>
      )}

      <div className="mc-layout">
        <div className="mc-worklist">
          <div className="mc-section-head">
            <div><p className="mc-kicker">Bài tập của bạn</p><h2>Việc cần làm</h2></div>
            <p>Ưu tiên theo deadline, sau đó mới tới lịch sử đã nộp.</p>
          </div>
          {assignments == null ? (
            <div className="mc-empty" role="alert">Chưa đọc được danh sách bài tập. Không có trạng thái “đã hết bài” nào được suy diễn.</div>
          ) : assignments.length === 0 ? (
            <div className="mc-empty">Chưa có bài tập nào. Khi giảng viên giao bài, bài sẽ hiện ở đây.</div>
          ) : (
            <>
              <TaskGroup title="Quá hạn chưa nộp" rows={missing} startingItem={startingItem} onStart={onStart} />
              <TaskGroup title="Cần nộp" rows={todo} startingItem={startingItem} onStart={onStart} />
              <TaskGroup title="Đã nộp" rows={done} startingItem={startingItem} onStart={onStart} />
            </>
          )}
        </div>
        <aside className="mc-aside" aria-label="Nhịp học và nội dung buổi học">
          {assignments && <ClassRhythm assignments={assignments} now={now} />}
          <Lessons lessons={snapshot.lessons} />
        </aside>
      </div>
    </>
  );
}

export function MyClassWorkspace() {
  const { status, user } = useAuth();
  const accountKey = status === 'signed-in' && user?.id ? user.id : null;
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  // A snapshot is private account-scoped data. AuthProvider can switch users
  // without remounting this component, so phase alone cannot prove that the
  // current snapshot belongs to the account being rendered.
  const [stateAccount, setStateAccount] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [startingItem, setStartingItem] = useState<string | null>(null);
  // Next 16 prerenders Client Components too; reading wall-clock time during
  // render makes the static route nondeterministic. The visibility/timer effect
  // owns the first real timestamp after mount.
  const [now, setNow] = useState(0);
  const requestRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const startingItemRef = useRef<string | null>(null);
  const accountRef = useRef(accountKey);
  accountRef.current = accountKey;
  const deadlineReloaded = useRef(new Set<string>());
  const deadlineRetryAfter = useRef(new Map<string, number>());

  useEffect(() => {
    if (status === 'signed-out') window.location.replace('/login');
  }, [status]);

  const load = useCallback(async (initial = false) => {
    if (!accountKey) return false;
    const owner = accountKey;
    const request = ++requestRef.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    if (initial) {
      setStateAccount(owner);
      setPhase('loading');
      setSnapshot(null);
      setError(null);
      setRefreshError(null);
    }
    try {
      const ready = await whenGlobalReady(() => !!window.api?.getWith, 'window.api (My Class)');
      if (!ready || accountRef.current !== owner || request !== requestRef.current) {
        throw new Error('API của trang chưa sẵn sàng.');
      }
      const raw = await window.api.getWith<unknown>('/api/class/me', undefined, { signal: controller.signal });
      if (accountRef.current !== owner || request !== requestRef.current) return false;
      const parsed = normalizeMyClassResponse(raw) as Snapshot;
      if (!parsed) throw new Error('Máy chủ trả dữ liệu lớp không đúng hợp đồng.');
      setNow(Date.now());
      setSnapshot(parsed);
      setPhase('ready');
      setRefreshError(null);
      return true;
    } catch (caught) {
      if (controller.signal.aborted || accountRef.current !== owner
          || request !== requestRef.current) return false;
      const message = caught instanceof Error ? caught.message : String(caught);
      if (initial) { setPhase('error'); setError(message); }
      else setRefreshError(`Không đồng bộ được trạng thái mới: ${message}`);
      return false;
    }
  }, [accountKey]);

  useEffect(() => {
    deadlineReloaded.current.clear();
    deadlineRetryAfter.current.clear();
    startingItemRef.current = null;
    setStartingItem(null);
    if (!accountKey) {
      setStateAccount(null);
      setPhase('loading');
      setSnapshot(null);
      return undefined;
    }
    void load(true);
    return () => {
      requestRef.current += 1;
      controllerRef.current?.abort();
    };
  }, [accountKey, load]);

  useEffect(() => {
    if (phase !== 'ready') return undefined;
    let timer: number | null = null;
    const start = () => {
      setNow(Date.now());
      if (timer == null) timer = window.setInterval(() => setNow(Date.now()), 1000);
    };
    const stop = () => { if (timer != null) window.clearInterval(timer); timer = null; };
    const onVisibility = () => {
      if (document.hidden) stop();
      else { start(); void load(false); }
    };
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility); };
  }, [phase, load]);

  const due = useMemo(() => snapshot?.hasClass && snapshot.assignments
    ? nextDue(snapshot.assignments) : null, [snapshot]);
  useEffect(() => {
    if (!due || due.at > now || deadlineReloaded.current.has(due.row.itemId)) return;
    const retryAt = deadlineRetryAfter.current.get(due.row.itemId) || 0;
    if (Date.now() < retryAt) return;
    deadlineRetryAfter.current.set(due.row.itemId, Number.POSITIVE_INFINITY);
    void load(false).then((ok) => {
      if (ok) deadlineReloaded.current.add(due.row.itemId);
      else deadlineRetryAfter.current.set(due.row.itemId, Date.now() + 15000);
    });
  }, [due, now, load]);

  const startAssignment = useCallback(async (row: Assignment) => {
    if (!accountKey || startingItemRef.current) return;
    const owner = accountKey;
    startingItemRef.current = row.itemId;
    setStartingItem(row.itemId);
    try {
      const raw = await window.api.post<unknown>(
        `/api/class/assignments/${encodeURIComponent(row.itemId)}/start`,
      );
      if (accountRef.current !== owner) return;
      const target = normalizeClassStartResponse(raw, row.itemId) as StartTarget | null;
      if (!target) throw new Error('Máy chủ không trả điểm đến hợp lệ cho bài này.');
      if (target.kind === 'course') {
        const view = target.reviewOnly ? '&view=writing' : '';
        const item = target.reviewOnly ? `&class_item=${encodeURIComponent(target.itemId)}` : '';
        window.location.assign(`/course-exercises?bank=${encodeURIComponent(target.bankId)}${view}${item}`);
        return;
      }
      if (target.kind === 'player') {
        if (!isKnownPlayerSurface(target.surface)) throw new Error('Player không được hỗ trợ.');
        window.location.assign(admitCorePlayer(target.surface, target.query));
        return;
      }
      if (target.kind === 'stable-player') {
        window.location.assign(target.url);
        return;
      }
      if (target.kind === 'admission') {
        window.location.assign(target.url);
        return;
      }
      if (target.kind === 'result') {
        window.location.assign(target.url);
        return;
      }
      const created = await window.api.post<unknown>('/sessions', target.body);
      if (accountRef.current !== owner) return;
      const session = created && typeof created === 'object' ? created as Record<string, unknown> : null;
      const sessionId = typeof session?.id === 'string' && session.id.trim() ? session.id.trim()
        : typeof session?.session_id === 'string' && session.session_id.trim() ? session.session_id.trim() : '';
      if (!sessionId) throw new Error('Máy chủ không trả về buổi học hợp lệ.');
      window.location.assign(admitCorePlayer('speaking', { session_id: sessionId }));
    } catch (caught) {
      if (accountRef.current !== owner) return;
      const message = caught instanceof Error ? caught.message : String(caught);
      window.showToast(`Không mở được bài: ${message}`, 'error', { timeout: 6000 });
      startingItemRef.current = null;
      setStartingItem(null);
    }
  }, [accountKey]);

  if (status !== 'signed-in' || !accountKey || stateAccount !== accountKey || phase === 'loading') {
    return <main className="mc-shell"><div className="mc-note" role="status">Đang tải lớp của bạn…</div></main>;
  }
  if (phase === 'error' || !snapshot) {
    return (
      <main className="mc-shell">
        <div className="mc-empty" role="alert">
          <strong>Không tải được lớp của bạn.</strong><p>{error || 'Vui lòng thử lại.'}</p>
          <button className="av-button av-button-primary" type="button" onClick={() => void load(true)}>Tải lại</button>
        </div>
      </main>
    );
  }
  if (!snapshot.hasClass) {
    return (
      <main className="mc-shell">
        <section>
          <header className="mc-head mc-head--empty">
            <p className="mc-eyebrow">MY CLASS</p><h1>Không gian lớp học của bạn</h1>
            <p className="mc-lead">Bài tập, deadline và nội dung từng buổi sẽ được gom về một nơi.</p>
          </header>
          <div className="mc-empty">Bạn chưa được xếp vào lớp nào. Khi giảng viên thêm bạn vào lớp, bài tập và nội dung buổi học sẽ hiện ở đây.</div>
        </section>
      </main>
    );
  }
  return (
    <main className="mc-shell">
      <div id="mc-content">
        <ReadyView
          snapshot={snapshot}
          now={now}
          refreshError={refreshError}
          startingItem={startingItem}
          onRetry={() => void load(false)}
          onStart={(row) => void startAssignment(row)}
        />
      </div>
    </main>
  );
}
