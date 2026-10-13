'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { listeningLessonHref, listeningLibraryFilter, listeningLibraryHref } from '@/lib/listening-library-context.mjs';

import { useAuth } from '@/lib/auth/auth-provider';
import type { ListeningOverviewWire, ListeningProgrammeLessonsWire } from '@/lib/listening-programmes-api';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';
import { ListeningSourceEntry } from './ielts/80-days/source-collection';

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
type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; lessons: Lesson[]; partial: boolean };
type OverviewState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; counts: IeltsModeCounts; sourceAvailable: boolean | null };
type LibraryProps = { programmeId: string; title: string; description: string; showIeltsModes?: boolean };

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

export function ListeningProgrammeLibrary(props: LibraryProps) {
  const { status, user } = useAuth();
  useEffect(() => {
    if (status === 'signed-out') window.location.replace('/login');
  }, [status]);
  const accountKey = status === 'signed-in' && user?.id ? user.id : null;
  return <ProgrammeLibraryData {...props} accountKey={accountKey} key={accountKey || status} />;
}

function ProgrammeLibraryData({ programmeId, title, description, showIeltsModes = false, accountKey }: LibraryProps & { accountKey: string | null }) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [overview, setOverview] = useState<OverviewState>({ status: 'loading' });
  const [revision, setRevision] = useState(0);
  const params = useSearchParams();
  const filter = listeningLibraryFilter(params || undefined) as Filter;
  const programmePath = programmeId === 'general-listening-practice' ? 'general' : 'ielts';
  const scrollKey = accountKey
    ? `aver:listening-library-scroll:v1:${accountKey}:${listeningLibraryHref(programmePath, { filter })}` : null;
  const rememberScroll = () => {
    if (!scrollKey) return;
    try { window.sessionStorage.setItem(scrollKey, String(window.scrollY)); } catch { /* navigation remains usable */ }
  };
  const setFilter = (next: Filter) => window.history.replaceState(null, '', listeningLibraryHref(programmePath, { filter: next }));

  useEffect(() => {
    if (!accountKey) return;
    const controller = new AbortController();
    let active = true;
    setState({ status: 'loading' });
    setOverview({ status: 'loading' });
    const failed = (error: unknown) => !active || (error instanceof DOMException && error.name === 'AbortError');
    (async () => {
      const ready = await whenGlobalReady(() => !!window.api?.getWith, 'window.api (listening programme)');
      if (!active) return;
      if (!ready) {
        setState({ status: 'error', message: 'Không tải được thư viện. Hãy thử lại.' });
        setOverview({ status: 'error' });
        return;
      }
      // Each surface settles independently. Progress/counts must not hold the
      // lesson list or the permanent IELTS navigation behind a slow request.
      void window.api.getWith<ListeningProgrammeLessonsWire>(
        `/api/listening/programmes/${encodeURIComponent(programmeId)}/lessons?limit=100`,
        undefined, { signal: controller.signal },
      ).then((lessonPayload) => {
        if (!active) return;
        const payload = record(lessonPayload);
        const items = Array.isArray(payload.items) ? payload.items : [];
        const lessons = items.map((value) => {
          const row = record(value);
          return {
            id: String(row.id || ''), title: String(row.title || 'Bài nghe'),
            instructions: String(row.instructions || ''),
            outcomes: Array.isArray(row.outcomes) ? row.outcomes.map(String) : [],
            sequence: Number(row.sequence_num || 0), formCount: Number(row.form_count || 0),
            completed: Number(row.completed_form_count || 0),
            independentCompleted: Number(row.independent_completed_form_count || 0),
            inProgress: Number(row.in_progress_form_count || 0),
          };
        }).filter((lesson) => lesson.id && lesson.formCount > 0);
        setState({ status: 'ready', lessons, partial: payload.partial_data === true });
      }).catch((error: unknown) => {
        if (!failed(error)) setState({ status: 'error', message: 'Không tải được thư viện. Hãy thử lại.' });
      });
      if (showIeltsModes) {
        void window.api.getWith<ListeningOverviewWire>('/api/listening/overview', undefined, { signal: controller.signal }).then((overviewPayload) => {
          if (!active) return;
          const payload = record(overviewPayload);
          const tests = record(payload.tests);
          const count = (value: unknown) => { const number = Number(value); return Number.isFinite(number) && number > 0 ? number : 0; };
          setOverview({ status: 'ready', counts: { practice: count(tests.practice), drill: count(tests.drill), mini: count(tests.mini), full: count(tests.full) },
            sourceAvailable: Array.isArray(payload.programmes) && payload.programmes.some((value) => record(value).id === 'ielts-80-days-listening')
              ? true : payload.partial_data === true ? null : false,
          });
        }).catch((error: unknown) => { if (!failed(error)) setOverview({ status: 'error' }); });
      }
    })();
    return () => { active = false; controller.abort(); };
  }, [programmeId, showIeltsModes, accountKey, revision]);

  const visible = useMemo(() => state.status === 'ready'
    ? state.lessons.filter((lesson) => filter === 'all' || lessonState(lesson) === filter)
    : [], [filter, state]);
  useEffect(() => {
    if (state.status !== 'ready' || !scrollKey) return;
    let savedTop: number | null = null;
    try {
      const raw = window.sessionStorage.getItem(scrollKey);
      const top = Number(raw);
      if (raw !== null && Number.isFinite(top) && top >= 0) savedTop = top;
    } catch { /* scroll restoration is optional */ }
    const frame = requestAnimationFrame(() => {
      if (savedTop !== null) window.scrollTo({ top: savedTop, behavior: 'instant' });
    });
    window.addEventListener('scroll', rememberScroll, { passive: true });
    window.addEventListener('pagehide', rememberScroll);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('scroll', rememberScroll); window.removeEventListener('pagehide', rememberScroll); };
  }, [state.status, scrollKey]);

  return (
    <main className="shell listening-library">
      <a className="listening-back" href="/listening">← Luyện nghe</a>
      <header className="listening-library__hero">
        <p className="listening-kicker">Chương trình</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </header>
      {showIeltsModes ? <section className="listening-ielts-modes" aria-labelledby="ielts-modes-heading">
        <div className="listening-section-heading"><div><p className="listening-kicker">Luyện thi IELTS</p><h2 id="ielts-modes-heading">Chọn mức độ mô phỏng đề thi</h2></div><span>Điểm và band chỉ xuất hiện ở chế độ đủ điều kiện</span></div>
        {overview.status !== 'ready' ? <p className="listening-mode-note" role="status">{overview.status === 'loading' ? 'Đang tải số bài; bạn có thể mở thư viện ngay.' : 'Số lượng bài tạm thời chưa tải được; các thư viện vẫn có thể mở.'}</p> : null}
        <div className="listening-ielts-modes__grid">
          {IELTS_MODES.filter((mode) => overview.status === 'ready' ? overview.counts[mode.key] > 0 : mode.key !== 'practice').map((mode, index) => <a href={mode.href} className="listening-ielts-mode-card" key={mode.key}><span>{String(index + 1).padStart(2, '0')}</span><div><h3>{mode.title}{overview.status === 'ready' ? <em>{overview.counts[mode.key]} bài</em> : null}</h3><p>{mode.contract}</p></div><strong aria-hidden="true">→</strong></a>)}
        </div>
      </section> : null}
      {showIeltsModes ? <ListeningSourceEntry availability={overview.status === 'ready' ? overview.sourceAvailable === null ? 'error' : overview.sourceAvailable ? 'available' : 'unavailable' : overview.status} retry={() => setRevision((value) => value + 1)} /> : null}
      <nav className="listening-filter" aria-label="Lọc bài học">
        {FILTERS.map(([value, label]) => (
          <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>
        ))}
      </nav>
      {state.status === 'loading' ? <div className="listening-state" role="status">Đang tải bài học…</div> : null}
      {state.status === 'error' ? <div className="listening-state is-error" role="alert"><p>{state.message}</p><button type="button" onClick={() => window.location.reload()}>Thử lại</button></div> : null}
      {state.status === 'ready' && state.partial ? <div className="error-banner" role="status">Tiến độ có thể chưa đầy đủ; nội dung bài học vẫn dùng dữ liệu đã xuất bản.</div> : null}
      {state.status === 'ready' && visible.length === 0 ? <div className="listening-state"><p>Chưa có bài học ở trạng thái này.</p></div> : null}
      {visible.length ? <div className="listening-lessons-grid">
        {visible.map((lesson) => {
          const statusValue = lessonState(lesson);
          const percent = lesson.formCount ? Math.round((lesson.completed / lesson.formCount) * 100) : 0;
          return <a className="listening-lesson-card" href={listeningLessonHref(programmePath, lesson.id, { filter })} onClick={rememberScroll} key={lesson.id}>
            <div className="listening-lesson-card__top"><span>Bài {lesson.sequence}</span><em data-state={statusValue}>{statusValue === 'completed' ? 'Đã xong' : statusValue === 'in_progress' ? 'Đang học' : 'Mới'}</em></div>
            <h2>{lesson.title}</h2>
            <p>{lesson.instructions || lesson.outcomes[0] || 'Luyện nghe theo nội dung và mục tiêu của bài.'}</p>
            <div className="listening-programme-card__progress" role="progressbar" aria-label={`Tiến độ ${lesson.title}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><span style={{ width: `${percent}%` }} /></div>
            <footer><span>{lesson.completed}/{lesson.formCount} bài nghe · {lesson.independentCompleted} độc lập</span><strong>Mở bài →</strong></footer>
          </a>;
        })}
      </div> : null}

    </main>
  );
}
