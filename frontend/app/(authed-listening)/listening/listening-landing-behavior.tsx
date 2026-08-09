'use client';

import { useEffect, useState, type ReactNode } from 'react';

import { useAuth } from '@/lib/auth/auth-provider';
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
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; overview: Overview }
  | { status: 'error'; message: string };

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

function normalizeOverview(payload: unknown): Overview {
  const root = objectValue(payload);
  const tests = objectValue(root.tests);
  const modes = objectValue(root.exercise_modes);
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
  };
}

function errorMessage(caught: unknown): string {
  if (caught instanceof Error && caught.message) return caught.message;
  return caught == null ? '' : String(caught);
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

function LibraryIcon() {
  return <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="lucide lucide-library"><path d="m16 6 4 14" /><path d="M12 6v14" /><path d="M8 8v12" /><path d="M4 4v16" /></svg>;
}

function AwardIcon() {
  return <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="lucide lucide-award"><path d="m15.477 12.89 1.515 8.526a.5.5 0 0 1-.81.47l-3.58-2.687a1 1 0 0 0-1.197 0l-3.586 2.686a.5.5 0 0 1-.81-.469l1.514-8.526" /><circle cx="12" cy="8" r="6" /></svg>;
}

function TargetIcon() {
  return <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="lucide lucide-target"><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></svg>;
}

function ZapIcon() {
  return <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="lucide lucide-zap"><path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" /></svg>;
}

function HeadphonesIcon() {
  return <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="lucide lucide-headphones"><path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3" /></svg>;
}

function ChartIcon() {
  return <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="lucide lucide-bar-chart-3"><path d="M3 3v16a2 2 0 0 0 2 2h16" /><path d="M18 17V9" /><path d="M13 17V5" /><path d="M8 17v-3" /></svg>;
}

function ExamCards({ overview, unverified = false }: { overview?: Overview; unverified?: boolean }) {
  const count = (key: keyof Overview['tests']) => unverified ? null : overview?.tests[key];
  return (
    <>
      {(unverified || !!overview?.tests.full) && (
        <ModeCard href="/listening/tests" mode="full-test" label="Full Test" icon={<LibraryIcon />} count={count('full')}>
          Đề Cambridge đầy đủ 40 câu / 4 section, không tua lại — sát điều kiện phòng thi. Có chấm điểm, band ước tính và chép chính tả theo đề.
        </ModeCard>
      )}
      {(unverified || !!overview?.tests.mini) && (
        <ModeCard href="/listening/mini-test" mode="mini-test" label="Mini Test" icon={<AwardIcon />} count={count('mini')}>
          Bài ngắn 1 section — làm bài &amp; chữa bài như Full Test, chấm điểm + band. Hợp khi bạn chỉ có 10–15 phút.
        </ModeCard>
      )}
      {(unverified || !!overview?.tests.drill) && (
        <ModeCard href="/listening/skills" mode="skills-practice" label="Luyện kĩ năng" icon={<TargetIcon />} count={count('drill')}>
          Tập trung từng dạng bài (điền form, bản đồ, nối, trắc nghiệm…) — làm bài &amp; chữa bài như Mini Test.
        </ModeCard>
      )}
      {(unverified || !!overview?.tests.practice) && (
        <ModeCard href="/listening/practice" mode="practice" label="Luyện nhanh" icon={<ZapIcon />} count={count('practice')}>
          Bài ngắn 30–90 giây, thông tin dày. Luyện riêng từng loại bẫy, hoặc đoạn mô phỏng Part 1/2/3 — làm được vài bài trong lúc chờ.
        </ModeCard>
      )}
    </>
  );
}

function ListeningLandingSurface({ state }: { state: LoadState }) {
  const ready = state.status === 'ready' ? state.overview : undefined;
  const examCount = ready
    ? Object.values(ready.tests).filter((count) => count > 0).length
    : 0;
  const showLibrary = !!ready && ready.content > 0 && ready.modeLabels.length > 0;

  return (
    <>
      <section className="vocab-modes" aria-labelledby="exam-heading">
        <h2 id="exam-heading">Luyện theo đề</h2>
        <div className="modes-grid">
          <ExamCards overview={ready} unverified={state.status === 'error'} />
        </div>
        {state.status === 'ready' && examCount === 0 && (
          <p className="ll-empty" id="exam-empty">
            Chưa có đề nào được xuất bản. Hãy quay lại sau khi quản trị viên đăng bài mới.
          </p>
        )}
      </section>

      {showLibrary && (
        <section className="vocab-modes" id="section-library" aria-labelledby="library-heading">
          <h2 id="library-heading">Luyện tự do theo bài nghe</h2>
          <div className="modes-grid">
            <ModeCard href="/listening/browse" mode="browse" label="Kho bài nghe" icon={<HeadphonesIcon />} count={ready.content}>
              Nghe tự do theo chủ đề, giọng và trình độ. Dạng luyện đang có: {ready.modeLabels.join(' · ')}.
            </ModeCard>
          </div>
        </section>
      )}

      <section className="vocab-modes" aria-labelledby="progress-heading">
        <h2 id="progress-heading">Tiến độ</h2>
        <div className="modes-grid">
          <ModeCard href="/listening/analytics" mode="analytics" label="Thống kê" icon={<ChartIcon />}>
            Điểm theo thời gian, dạng câu hay sai và bẫy hay mắc.
          </ModeCard>
        </div>
      </section>

      {state.status === 'error' && (
        <div className="error-banner" id="landing-error">
          Không tải được số lượng bài. Danh sách bên dưới vẫn mở được. {state.message}
        </div>
      )}
    </>
  );
}

export function ListeningLandingBehavior() {
  const { status, user } = useAuth();

  useEffect(() => {
    if (status === 'signed-out') window.location.replace('/login.html');
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
        if (!disposed) setState({ status: 'error', message: '' });
        return;
      }
      try {
        const payload = await window.api.getWith<unknown>(
          '/api/listening/overview',
          undefined,
          { signal: controller.signal },
        );
        if (!disposed) setState({ status: 'ready', overview: normalizeOverview(payload) });
      } catch (caught: unknown) {
        if (disposed || (caught instanceof DOMException && caught.name === 'AbortError')) return;
        setState({ status: 'error', message: errorMessage(caught) });
      }
    })();

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [accountKey]);

  return <ListeningLandingSurface state={state} />;
}
