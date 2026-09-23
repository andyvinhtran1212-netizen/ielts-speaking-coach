'use client';

import { useEffect, useState, type ReactNode } from 'react';

import { useAuth } from '@/lib/auth/auth-provider';
import { needsPermanentIeltsNavigation } from '@/lib/listening-programme-navigation.mjs';
import type { ListeningOverviewWire } from '@/lib/listening-programmes-api';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

const MODE_LABELS = [
  ['dictation', 'Chép chính tả'],
  ['gist', 'Nghe ý chính'],
  ['true_false', 'Đúng / Sai'],
  ['mcq', 'Trắc nghiệm'],
] as const;

interface Overview {
  tests: {
    full: number;
    mini: number;
    drill: number;
    practice: number;
  };
  content: number;
  modeLabels: string[];
  programmes: Programme[];
  resume: ResumeCard | null;
  recent: RecentActivity[];
  partialData: boolean;
}

interface Programme {
  id: string;
  title: string;
  description: string;
  lessonCount: number;
  formCount: number;
  completedCount: number;
  independentCompletedCount: number;
  inProgressCount: number;
}

interface ResumeCard {
  attemptId: string;
  testId: string;
  title: string;
  programmeId: string;
  answeredCount: number;
  itemCount: number;
  assisted: boolean;
  resumeExpiresAt: string;
  href: string;
}

interface RecentActivity {
  attemptId: string;
  title: string;
  programmeId: string;
  checkedCount: number;
  correctCount: number;
  unscoredCount: number;
  assisted: boolean;
  href: string;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; overview: Overview }
  | { status: 'error' };

function strictPositiveCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function coerciblePositiveCount(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function safeDateTime(value: unknown): string {
  const text = typeof value === 'string' ? value : '';
  return text && Number.isFinite(Date.parse(text)) ? text : '';
}

function normalizeOverview(payload: unknown): Overview {
  const root = objectValue(payload);
  const tests = objectValue(root.tests);
  const modes = objectValue(root.exercise_modes);
  const programmes = Array.isArray(root.programmes) ? root.programmes : [];
  const resume = objectValue(root.resume);
  const recent = Array.isArray(root.recent) ? root.recent : [];
  return {
    tests: {
      full: strictPositiveCount(tests.full),
      mini: strictPositiveCount(tests.mini),
      drill: strictPositiveCount(tests.drill),
      practice: strictPositiveCount(tests.practice),
    },
    content: strictPositiveCount(root.content),
    modeLabels: MODE_LABELS
      .filter(([key]) => coerciblePositiveCount(modes[key]) > 0)
      .map(([, label]) => label),
    programmes: programmes.map((value) => {
      const row = objectValue(value);
      return {
        id: String(row.id || ''),
        title: String(row.title || 'Chương trình nghe'),
        description: String(row.description || ''),
        lessonCount: strictPositiveCount(row.lesson_count),
        formCount: strictPositiveCount(row.form_count),
        completedCount: strictPositiveCount(row.completed_form_count),
        independentCompletedCount: strictPositiveCount(row.independent_completed_form_count),
        inProgressCount: strictPositiveCount(row.in_progress_form_count),
      };
    }).filter((row) => row.id && row.formCount > 0),
    resume: resume.attempt_id ? {
      attemptId: String(resume.attempt_id),
      testId: String(resume.test_id || ''),
      title: String(resume.title || 'Bài nghe đang làm'),
      programmeId: String(resume.programme_id || ''),
      answeredCount: strictPositiveCount(resume.answered_count),
      itemCount: strictPositiveCount(resume.item_count),
      assisted: resume.assisted === true,
      resumeExpiresAt: safeDateTime(resume.resume_expires_at),
      href: String(resume.href || ''),
    } : null,
    recent: recent.map((value) => {
      const row = objectValue(value);
      return {
        attemptId: String(row.attempt_id || ''),
        title: String(row.title || 'Bài nghe'),
        programmeId: String(row.programme_id || ''),
        checkedCount: strictPositiveCount(row.checked_count),
        correctCount: strictPositiveCount(row.correct_count),
        unscoredCount: strictPositiveCount(row.unscored_count),
        assisted: row.assisted === true,
        href: String(row.href || ''),
      };
    }).filter((row) => row.attemptId && row.href).slice(0, 3),
    partialData: root.partial_data === true,
  };
}

interface ModeCardProps {
  href: string;
  mode: string;
  label: string;
  icon: ReactNode;
  children: ReactNode;
  count?: number | null;
}

function ModeCard({ href, mode, label, icon, children, count }: ModeCardProps) {
  return (
    <a href={href} className="mode-card" data-mode={mode} aria-label={label}>
      <div className="head">
        <div className="icon">{icon}</div>
        <span className="arrow" aria-hidden="true">→</span>
      </div>
      <h3>
        {label}
        {typeof count === 'number' && <span className="mode-card__badge">{count} bài</span>}
      </h3>
      <p className="lede">{children}</p>
    </a>
  );
}

function HeadphonesIcon() {
  return <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="lucide lucide-headphones"><path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3" /></svg>;
}

function ChartIcon() {
  return <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="lucide lucide-bar-chart-3"><path d="M3 3v16a2 2 0 0 0 2 2h16" /><path d="M18 17V9" /><path d="M13 17V5" /><path d="M8 17v-3" /></svg>;
}

function ProgrammeCard({ programme }: { programme: Programme }) {
  const href = programme.id === 'general-listening-practice'
    ? '/listening/general'
    : '/listening/ielts';
  const progress = programme.formCount
    ? Math.round((programme.completedCount / programme.formCount) * 100)
    : 0;
  return (
    <a className="listening-programme-card" href={href}>
      <span className="listening-programme-card__eyebrow">
        {programme.lessonCount} bài học · {programme.formCount} bài nghe
      </span>
      <h3>{programme.title}</h3>
      <p>{programme.description}</p>
      <div className="listening-programme-card__progress" role="progressbar" aria-label="Tiến độ chương trình" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
        <span style={{ width: `${progress}%` }} />
      </div>
      <div className="listening-programme-card__foot">
        <span>{programme.completedCount} đã xong · {programme.independentCompletedCount} độc lập{programme.inProgressCount ? ` · ${programme.inProgressCount} đang làm` : ''}</span>
        <strong>Khám phá →</strong>
      </div>
    </a>
  );
}

function IeltsNavigationCard() {
  return (
    <a className="listening-programme-card" href="/listening/ielts">
      <span className="listening-programme-card__eyebrow">IELTS Listening</span>
      <h3>Luyện tập và mô phỏng đề</h3>
      <p>Quick Practice, Skills, Mini và Full Test luôn sẵn sàng; bài report-only xuất hiện tại đây sau khi được phát hành.</p>
      <div className="listening-programme-card__foot">
        <span>Quick · Skills · Mini · Full Test</span>
        <strong>Khám phá →</strong>
      </div>
    </a>
  );
}

function ProgrammeFallbackLinks() {
  return (
    <section className="listening-programmes" aria-labelledby="programme-fallback-heading">
      <div className="listening-section-heading"><div><p className="listening-kicker">Thư viện</p><h2 id="programme-fallback-heading">Chọn chương trình luyện tập</h2></div></div>
      <div className="listening-programmes__grid">
        <a className="listening-programme-card" href="/listening/general"><span className="listening-programme-card__eyebrow">General Listening</span><h3>Luyện nghe theo bài học</h3><p>Tình huống và mục tiêu nghe cụ thể; tự đối chiếu sau khi nộp.</p><div className="listening-programme-card__foot"><span>Số bài tạm thời chưa tải được</span><strong>Mở thư viện →</strong></div></a>
        <a className="listening-programme-card" href="/listening/ielts"><span className="listening-programme-card__eyebrow">IELTS Listening</span><h3>Luyện tập và mô phỏng đề</h3><p>IELTS Practice report-only cùng các thư viện Quick, Skills, Mini và Full Test.</p><div className="listening-programme-card__foot"><span>Số bài tạm thời chưa tải được</span><strong>Mở thư viện →</strong></div></a>
      </div>
    </section>
  );
}

function ResumePanel({ resume }: { resume: ResumeCard }) {
  const progress = resume.itemCount
    ? Math.round((resume.answeredCount / resume.itemCount) * 100)
    : 0;
  return (
    <section className="listening-resume" aria-labelledby="listening-resume-title">
      <div>
        <p className="listening-kicker">Tiếp tục từ lần trước</p>
        <h2 id="listening-resume-title">{resume.title}</h2>
        <p>{resume.answeredCount}/{resume.itemCount} câu đã lưu · {progress}%{resume.assisted ? ' · lượt học có hỗ trợ' : ''}{resume.resumeExpiresAt ? ` · tiếp tục trước ${new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }).format(new Date(resume.resumeExpiresAt))}` : ''}</p>
      </div>
      <a href={resume.href}>Tiếp tục luyện <span aria-hidden="true">→</span></a>
    </section>
  );
}

function NextActionPanel({ overview }: { overview: Overview }) {
  const firstProgramme = overview.programmes[0];
  const href = firstProgramme
    ? (firstProgramme.id === 'general-listening-practice' ? '/listening/general' : '/listening/ielts')
    : overview.tests.practice ? '/listening/practice'
    : overview.tests.mini ? '/listening/mini-test'
    : overview.tests.full ? '/listening/tests'
    : overview.content ? '/listening/browse'
    : '/listening/analytics';
  const title = firstProgramme ? `Bắt đầu với ${firstProgramme.title}` : 'Chọn một bài nghe để bắt đầu';
  return (
    <section className="listening-resume" aria-labelledby="listening-next-title">
      <div>
        <p className="listening-kicker">Gợi ý tiếp theo</p>
        <h2 id="listening-next-title">{title}</h2>
        <p>Chọn một lượt luyện phù hợp; tiến độ sẽ được lưu tự động.</p>
      </div>
      <a href={href}>Bắt đầu luyện <span aria-hidden="true">→</span></a>
    </section>
  );
}

function RecentList({ items }: { items: RecentActivity[] }) {
  if (!items.length) return null;
  return (
    <section className="listening-recent" aria-labelledby="listening-recent-title">
      <div className="listening-section-heading">
        <div><p className="listening-kicker">Hoạt động</p><h2 id="listening-recent-title">Gần đây</h2></div>
        <a href="/listening/analytics">Xem thống kê →</a>
      </div>
      <div className="listening-recent__list">
        {items.map((item) => (
          <a href={item.href} key={item.attemptId}>
            <span><strong>{item.title}</strong><small>{item.assisted ? 'Đã hoàn thành · có hỗ trợ' : 'Đã hoàn thành · độc lập'}</small></span>
            <span className="listening-recent__result">
              {item.checkedCount > 0 ? `${item.correctCount}/${item.checkedCount} câu tự động kiểm tra` : `${item.unscoredCount} câu tự đối chiếu`}
            </span>
          </a>
        ))}
      </div>
    </section>
  );
}

function ListeningLandingSurface({ state }: { state: LoadState }) {
  const ready = state.status === 'ready' ? state.overview : undefined;
  const showLibrary = !!ready && ready.content > 0 && ready.modeLabels.length > 0;

  return (
    <>
      {state.status === 'loading' ? (
        <div className="listening-loading" id="landing-loading" role="status">
          <span className="skeleton-num" /> Đang tải thư viện Listening…
        </div>
      ) : null}
      {ready?.resume ? <ResumePanel resume={ready.resume} /> : null}
      {ready && !ready.resume ? <NextActionPanel overview={ready} /> : null}

      {ready ? (
        <section className="listening-programmes" aria-labelledby="programme-heading">
          <div className="listening-section-heading">
            <div><p className="listening-kicker">Chương trình</p><h2 id="programme-heading">Chọn chương trình luyện tập</h2></div>
            <span>Chọn lộ trình phù hợp với mục tiêu luyện nghe</span>
          </div>
          <div className="listening-programmes__grid">
            {ready.programmes.map((programme) => <ProgrammeCard programme={programme} key={programme.id} />)}
            {needsPermanentIeltsNavigation(ready.programmes) ? <IeltsNavigationCard /> : null}
          </div>
        </section>
      ) : null}
      {state.status === 'error' ? <ProgrammeFallbackLinks /> : null}

      {ready ? <RecentList items={ready.recent} /> : null}

      {showLibrary && (
        <section className="listening-modes" id="section-library" aria-labelledby="library-heading">
          <h2 id="library-heading">Luyện tự do theo bài nghe</h2>
          <div className="modes-grid">
            <ModeCard href="/listening/browse" mode="browse" label="Kho bài nghe" icon={<HeadphonesIcon />} count={ready.content}>
              Nghe tự do theo chủ đề, giọng và trình độ. Dạng luyện đang có: {ready.modeLabels.join(' · ')}.
            </ModeCard>
          </div>
        </section>
      )}

      <section className="listening-modes" aria-labelledby="progress-heading">
        <h2 id="progress-heading">Tiến độ</h2>
        <div className="modes-grid">
          <ModeCard href="/listening/analytics" mode="analytics" label="Thống kê" icon={<ChartIcon />}>
            Điểm theo thời gian, dạng câu hay sai và bẫy hay mắc.
          </ModeCard>
        </div>
      </section>

      {ready?.partialData ? (
        <div className="error-banner" role="status">Một phần tiến độ chưa tải được. Số bài trong thư viện vẫn là dữ liệu đã xuất bản.</div>
      ) : null}

      {state.status === 'error' && (
        <div className="error-banner" id="landing-error" role="alert">
          Không tải được số lượng bài. Danh sách bên dưới vẫn mở được.
        </div>
      )}
    </>
  );
}

export function ListeningLandingBehavior() {
  const { status, user } = useAuth();

  useEffect(() => {
    if (status === 'signed-out') window.location.replace('/login');
  }, [status]);

  if (status !== 'signed-in' || !user?.id) {
    return <ListeningLandingSurface state={{ status: 'loading' }} />;
  }

  return <ListeningLandingData accountKey={user.id} key={user.id} />;
}

function ListeningLandingData({ accountKey }: { accountKey: string }) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    setState({ status: 'loading' });

    (async () => {
      const ready = await whenGlobalReady(
        () => !!window.api?.getWith,
        'window.api (listening landing overview)',
      );
      if (!ready || disposed) {
        if (!disposed) setState({ status: 'error' });
        return;
      }
      try {
        const payload = await window.api.getWith<ListeningOverviewWire>(
          '/api/listening/overview',
          undefined,
          { signal: controller.signal },
        );
        if (!disposed) setState({ status: 'ready', overview: normalizeOverview(payload) });
      } catch (caught: unknown) {
        if (disposed || (caught instanceof DOMException && caught.name === 'AbortError')) return;
        setState({ status: 'error' });
      }
    })();

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [accountKey]);

  return <ListeningLandingSurface state={state} />;
}
