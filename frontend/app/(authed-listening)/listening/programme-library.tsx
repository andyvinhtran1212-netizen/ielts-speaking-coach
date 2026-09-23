'use client';

import { useEffect, useMemo, useState } from 'react';

import { useAuth } from '@/lib/auth/auth-provider';
import type { ListeningOverviewWire, ListeningProgrammeLessonsWire } from '@/lib/listening-programmes-api';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

type Filter = 'all' | 'new' | 'in_progress' | 'completed';
interface Lesson {
  id: string;
  title: string;
  instructions: string;
  outcomes: string[];
  sequence: number;
  formCount: number;
  completed: number;
  independentCompleted: number;
  inProgress: number;
}
interface IeltsModeCounts { practice: number; drill: number; mini: number; full: number }
type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; lessons: Lesson[]; partial: boolean; lessonError: boolean; ieltsModeCounts: IeltsModeCounts | null };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function lessonState(lesson: Lesson): Exclude<Filter, 'all'> {
  if (lesson.formCount > 0 && lesson.completed === lesson.formCount) return 'completed';
  if (lesson.completed > 0 || lesson.inProgress > 0) return 'in_progress';
  return 'new';
}

const FILTERS: Array<[Filter, string]> = [
  ['all', 'Tất cả'], ['new', 'Chưa bắt đầu'], ['in_progress', 'Đang học'], ['completed', 'Đã hoàn thành'],
];

const IELTS_MODES = [
  { key: 'practice', href: '/listening/practice', title: 'Luyện nhanh', contract: 'Phản hồi từng câu · không phải Full Test' },
  { key: 'drill', href: '/listening/skills', title: 'Luyện kĩ năng', contract: 'Chấm điểm bài luyện theo dạng câu hỏi' },
  { key: 'mini', href: '/listening/mini-test', title: 'Mini Test', contract: 'Một section · có điểm và band ước tính' },
  { key: 'full', href: '/listening/tests', title: 'Full Test', contract: 'Bốn section · có điểm và band ước tính' },
] as const;

export function ListeningProgrammeLibrary({ programmeId, title, description, showIeltsModes = false }: { programmeId: string; title: string; description: string; showIeltsModes?: boolean }) {
  const { status, user } = useAuth();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    if (status === 'signed-out') window.location.replace('/login');
    if (status !== 'signed-in' || !user?.id) return;
    const controller = new AbortController();
    let active = true;
    setState({ status: 'loading' });
    (async () => {
      const ready = await whenGlobalReady(() => !!window.api?.getWith, 'window.api (listening programme)');
      if (!ready || !active) throw new Error('API chưa sẵn sàng');
      const [lessonResult, overviewResult] = await Promise.allSettled([
        window.api.getWith<ListeningProgrammeLessonsWire>(
          `/api/listening/programmes/${encodeURIComponent(programmeId)}/lessons?limit=100`,
          undefined,
          { signal: controller.signal },
        ),
        showIeltsModes
          ? window.api.getWith<ListeningOverviewWire>('/api/listening/overview', undefined, { signal: controller.signal })
          : Promise.resolve(null),
      ]);
      if (lessonResult.status === 'rejected' && !showIeltsModes) throw lessonResult.reason;
      const lessonPayload = lessonResult.status === 'fulfilled' ? lessonResult.value : {};
      const overviewPayload = overviewResult.status === 'fulfilled' ? overviewResult.value : null;
      const payload = record(lessonPayload);
      const items = Array.isArray(payload.items) ? payload.items : [];
      const lessons = items.map((value) => {
        const row = record(value);
        return {
          id: String(row.id || ''),
          title: String(row.title || 'Bài nghe'),
          instructions: String(row.instructions || ''),
          outcomes: Array.isArray(row.outcomes) ? row.outcomes.map(String) : [],
          sequence: Number(row.sequence_num || 0),
          formCount: Number(row.form_count || 0),
          completed: Number(row.completed_form_count || 0),
          independentCompleted: Number(row.independent_completed_form_count || 0),
          inProgress: Number(row.in_progress_form_count || 0),
        };
      }).filter((lesson) => lesson.id && lesson.formCount > 0);
      const tests = record(record(overviewPayload).tests);
      const ieltsModeCounts = overviewPayload ? {
        practice: Number(tests.practice || 0),
        drill: Number(tests.drill || 0),
        mini: Number(tests.mini || 0),
        full: Number(tests.full || 0),
      } : null;
      if (active) setState({ status: 'ready', lessons, partial: payload.partial_data === true, lessonError: lessonResult.status === 'rejected', ieltsModeCounts });
    })().catch((error: unknown) => {
      if (!active || (error instanceof DOMException && error.name === 'AbortError')) return;
      setState({ status: 'error', message: 'Không tải được thư viện. Hãy thử lại.' });
    });
    return () => { active = false; controller.abort(); };
  }, [programmeId, showIeltsModes, status, user?.id]);

  const visible = useMemo(() => state.status === 'ready'
    ? state.lessons.filter((lesson) => filter === 'all' || lessonState(lesson) === filter)
    : [], [filter, state]);
  const programmePath = programmeId === 'general-listening-practice' ? 'general' : 'ielts';

  return (
    <main className="shell listening-library">
      <a className="listening-back" href="/listening">← Luyện nghe</a>
      <header className="listening-library__hero">
        <p className="listening-kicker">Chương trình</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </header>
      <nav className="listening-filter" aria-label="Lọc bài học">
        {FILTERS.map(([value, label]) => (
          <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>
        ))}
      </nav>
      {state.status === 'loading' ? <div className="listening-state" role="status">Đang tải bài học…</div> : null}
      {state.status === 'error' ? <div className="listening-state is-error" role="alert"><p>{state.message}</p><button type="button" onClick={() => window.location.reload()}>Thử lại</button></div> : null}
      {state.status === 'ready' && state.partial ? <div className="error-banner" role="status">Tiến độ có thể chưa đầy đủ; nội dung bài học vẫn dùng dữ liệu đã xuất bản.</div> : null}
      {state.status === 'ready' && state.lessonError ? <div className="error-banner" role="alert">Chưa tải được IELTS Practice; các chế độ IELTS khác bên dưới vẫn mở được.</div> : null}
      {state.status === 'ready' && !state.lessonError && visible.length === 0 ? <div className="listening-state"><p>Chưa có bài học ở trạng thái này.</p></div> : null}
      {visible.length ? <div className="listening-lessons-grid">
        {visible.map((lesson) => {
          const statusValue = lessonState(lesson);
          const percent = lesson.formCount ? Math.round((lesson.completed / lesson.formCount) * 100) : 0;
          return <a className="listening-lesson-card" href={`/listening/${programmePath}/${lesson.id}`} key={lesson.id}>
            <div className="listening-lesson-card__top"><span>Bài {lesson.sequence}</span><em data-state={statusValue}>{statusValue === 'completed' ? 'Đã xong' : statusValue === 'in_progress' ? 'Đang học' : 'Mới'}</em></div>
            <h2>{lesson.title}</h2>
            <p>{lesson.instructions || lesson.outcomes[0] || 'Luyện nghe theo nội dung và mục tiêu của bài.'}</p>
            <div className="listening-programme-card__progress" role="progressbar" aria-label={`Tiến độ ${lesson.title}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><span style={{ width: `${percent}%` }} /></div>
            <footer><span>{lesson.completed}/{lesson.formCount} bài nghe · {lesson.independentCompleted} độc lập</span><strong>Mở bài →</strong></footer>
          </a>;
        })}
      </div> : null}
      {showIeltsModes && state.status === 'ready' ? <section className="listening-ielts-modes" aria-labelledby="ielts-modes-heading">
        <div className="listening-section-heading"><div><p className="listening-kicker">Luyện thi IELTS</p><h2 id="ielts-modes-heading">Chọn mức độ mô phỏng đề thi</h2></div><span>Điểm và band chỉ xuất hiện ở chế độ đủ điều kiện</span></div>
        {state.ieltsModeCounts === null ? <p className="listening-mode-note" role="status">Số lượng bài tạm thời chưa tải được; các thư viện vẫn có thể mở.</p> : null}
        <div className="listening-ielts-modes__grid">
          {IELTS_MODES.filter((mode) => state.ieltsModeCounts === null || state.ieltsModeCounts[mode.key] > 0).map((mode, index) => <a href={mode.href} className="listening-ielts-mode-card" key={mode.key}><span>{String(index + 1).padStart(2, '0')}</span><div><h3>{mode.title}{state.ieltsModeCounts !== null ? <em>{state.ieltsModeCounts[mode.key]} bài</em> : null}</h3><p>{mode.contract}</p></div><strong aria-hidden="true">→</strong></a>)}
        </div>
      </section> : null}
    </main>
  );
}
