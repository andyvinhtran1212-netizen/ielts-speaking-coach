'use client';

// Native React behavior cho hub từ vựng học viên. Backend tiếp tục là nguồn
// thật cho thống kê và feature flags; state được khóa theo user.id để account
// switch không ló dữ liệu của phiên trước.
import {
  useCallback,
  useEffect,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';

import { VocabModuleMount } from '@/components/vocab-module-mount';
import { useAuth } from '@/lib/auth/auth-provider';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

type HubMode = 'vocab-topics' | 'flashcards' | 'exercises';

interface KeyedState<T> {
  key: string;
  value: T;
}

interface VocabularyStats {
  wordsLearned: number;
  wordsMissed: number;
  quizSessions: number;
}

interface HomeSummaryPayload {
  skills?: {
    vocabulary?: {
      words_learned?: unknown;
      quiz_words_missed?: unknown;
      quiz_sessions?: unknown;
    } | null;
  } | null;
}

interface FeatureFlags {
  flashcardEnabled: boolean;
  d1Enabled: boolean;
}

interface AuthMePayload {
  flashcard_enabled?: unknown;
  d1_enabled?: unknown;
}

interface VocabCategory {
  slug?: unknown;
  title?: unknown;
  article_count?: unknown;
  articles?: unknown;
  topic_id?: unknown;
}

const VALID_MODES = new Set<HubMode>(['vocab-topics', 'flashcards', 'exercises']);

function isHubMode(value: string): value is HubMode {
  return VALID_MODES.has(value as HubMode);
}

function modeFromLocation(): HubMode | null {
  const value = window.location.hash.replace(/^#/, '');
  return isHubMode(value) ? value : null;
}

function nonNegativeInt(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

function parseStats(payload: HomeSummaryPayload): VocabularyStats | null {
  const vocabulary = payload?.skills?.vocabulary;
  if (!vocabulary) return null;
  return {
    wordsLearned: nonNegativeInt(vocabulary.words_learned),
    wordsMissed: nonNegativeInt(vocabulary.quiz_words_missed),
    quizSessions: nonNegativeInt(vocabulary.quiz_sessions),
  };
}

function categoryCount(category: VocabCategory): number {
  if (category.article_count !== null && category.article_count !== undefined) {
    return nonNegativeInt(category.article_count);
  }
  return Array.isArray(category.articles) ? category.articles.length : 0;
}

function categorySlug(category: VocabCategory): string {
  return typeof category.slug === 'string' ? category.slug.trim() : '';
}

function categoryTitle(category: VocabCategory, slug: string): string {
  return typeof category.title === 'string' && category.title.trim()
    ? category.title.trim()
    : slug;
}

function topicId(category: VocabCategory): string | null {
  if (typeof category.topic_id !== 'string' && typeof category.topic_id !== 'number') {
    return null;
  }
  const value = String(category.topic_id).trim();
  return value || null;
}

function StatValue({
  value,
  unit,
  loading,
  unavailable,
}: {
  value: number | undefined;
  unit: string;
  loading: boolean;
  unavailable: boolean;
}) {
  return (
    <span className="value">
      {loading ? (
        <span className="skeleton-num" aria-label="Đang tải" />
      ) : unavailable ? (
        <span className="stat-unavailable" aria-label="Không tải được thống kê">—</span>
      ) : (
        value ?? 0
      )}
      {' '}
      <span className="unit">{unit}</span>
    </span>
  );
}

function LibraryIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="lucide lucide-library">
      <path d="m16 6 4 14" /><path d="M12 6v14" /><path d="M8 8v12" /><path d="M4 4v16" />
    </svg>
  );
}

function PracticeIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="lucide lucide-pen-line">
      <path d="M13 21h8" /><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
    </svg>
  );
}

function LayersIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="lucide lucide-layers">
      <path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z" /><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12" /><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17" />
    </svg>
  );
}

function ExercisesIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="lucide lucide-dumbbell">
      <path d="M17.596 12.768a2 2 0 1 0 2.829-2.829l-1.768-1.767a2 2 0 0 0 2.828-2.829l-2.828-2.828a2 2 0 0 0-2.829 2.828l-1.767-1.768a2 2 0 1 0-2.829 2.829z" /><path d="m2.5 21.5 1.4-1.4" /><path d="m20.1 3.9 1.4-1.4" /><path d="M5.343 21.485a2 2 0 1 0 2.829-2.828l1.767 1.768a2 2 0 1 0 2.829-2.829l-6.364-6.364a2 2 0 1 0-2.829 2.829l1.768 1.767a2 2 0 0 0-2.828 2.829z" /><path d="m9.6 14.4 4.8-4.8" />
    </svg>
  );
}

function ExamIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="lucide lucide-graduation-cap">
      <path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z" /><path d="M22 10v6" /><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5" />
    </svg>
  );
}

function ModeCard({
  mode,
  href,
  label,
  title,
  description,
  icon,
  onOpen,
}: {
  mode?: HubMode;
  href: string;
  label: string;
  title: string;
  description: string;
  icon: ReactNode;
  onOpen?: (event: MouseEvent<HTMLAnchorElement>, mode: HubMode) => void;
}) {
  return (
    <a
      href={href}
      className="mode-card"
      data-mode={mode}
      aria-label={label}
      onClick={mode && onOpen ? (event) => onOpen(event, mode) : undefined}
    >
      <div className="head">
        <div className="icon">{icon}</div>
        <span className="arrow" aria-hidden="true">→</span>
      </div>
      <h3>{title}</h3>
      <p className="lede">{description}</p>
    </a>
  );
}

function TopicsPanel({ accountKey, shouldLoad }: { accountKey: string; shouldLoad: boolean }) {
  const [categoriesState, setCategoriesState] = useState<KeyedState<VocabCategory[]> | null>(null);
  const [errorState, setErrorState] = useState<KeyedState<boolean> | null>(null);
  const categories = categoriesState?.key === accountKey ? categoriesState.value : null;
  const failed = errorState?.key === accountKey;

  useEffect(() => {
    if (!shouldLoad) return;

    const controller = new AbortController();
    let disposed = false;
    setCategoriesState(null);
    setErrorState(null);

    (async () => {
      const ready = await whenGlobalReady(
        () => !!window.api?.getWith,
        'window.api (vocabulary topics)',
      );
      if (!ready || disposed) {
        if (!disposed) setErrorState({ key: accountKey, value: true });
        return;
      }

      try {
        const payload = await window.api.getWith<VocabCategory[]>(
          '/api/vocabulary/categories',
          undefined,
          { signal: controller.signal },
        );
        if (!disposed) {
          setCategoriesState({
            key: accountKey,
            value: Array.isArray(payload) ? payload : [],
          });
        }
      } catch (caught: unknown) {
        if (!disposed && !(caught instanceof DOMException && caught.name === 'AbortError')) {
          setErrorState({ key: accountKey, value: true });
        }
      }
    })();

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [accountKey, shouldLoad]);

  if (failed) {
    return <p className="vocab-panel-state is-error">Không tải được danh sách chủ đề.</p>;
  }
  if (!categories) {
    return <p className="vocab-panel-state">Đang tải chủ đề…</p>;
  }

  const visibleCategories = categories
    .map((category) => ({
      category,
      count: categoryCount(category),
      slug: categorySlug(category),
    }))
    .filter(({ count, slug }) => count > 0 && !!slug);

  if (!visibleCategories.length) {
    return <p className="vocab-panel-state">Chưa có chủ đề nào.</p>;
  }

  return (
    <>
      <div className="vtc-panel-head">
        <h2 className="vtc-panel-title">Chủ đề từ vựng</h2>
        <p className="vtc-panel-sub">Chọn chủ đề để khám phá từ vựng theo ngữ cảnh IELTS.</p>
        <a className="vtc-progress-link" href="/quiz/progress?skill_area=vocab">
          📊 Tiến độ luyện tập →
        </a>
      </div>
      <div className="vocab-topics-grid">
        {visibleCategories.map(({ category, count, slug }) => {
          const encodedSlug = encodeURIComponent(slug);
          const linkedTopicId = topicId(category);
          const practiceHref = `/quiz?skill_area=vocab${
            linkedTopicId ? `&topic_id=${encodeURIComponent(linkedTopicId)}` : ''
          }`;
          return (
            <article className="vocab-topic-card" key={slug}>
              <div className="vtc-body">
                <h3 className="vtc-title">{categoryTitle(category, slug)}</h3>
              </div>
              <div className="vtc-foot">
                <span className="vtc-count">
                  <span className="vtc-num">{count}</span>
                  <span className="vtc-unit">từ vựng</span>
                </span>
              </div>
              <div className="vtc-actions">
                <a className="vtc-act vtc-act--browse" href={`/vocabulary?cat=${encodedSlug}`}>Khám phá</a>
                <a className="vtc-act vtc-act--study" href={`/pages/flashcard-study.html?stack=wiki:${encodedSlug}`}>🃏 Flashcards</a>
                <a className="vtc-act vtc-act--ex" href={practiceHref}>✍️ Luyện tập</a>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}

export function VocabularyHubBehavior() {
  const { status, user } = useAuth();
  const requestKey = status === 'signed-in' && user?.id ? user.id : null;
  const [activeMode, setActiveMode] = useState<HubMode | null>(null);
  const [visitedState, setVisitedState] = useState<KeyedState<Set<HubMode>> | null>(null);
  const [statsState, setStatsState] = useState<KeyedState<VocabularyStats> | null>(null);
  const [statsErrorState, setStatsErrorState] = useState<KeyedState<boolean> | null>(null);
  const [flagsState, setFlagsState] = useState<KeyedState<FeatureFlags> | null>(null);

  const stats = statsState?.key === requestKey ? statsState.value : null;
  const statsFailed = statsErrorState?.key === requestKey;
  const flags = flagsState?.key === requestKey ? flagsState.value : null;
  const visited = visitedState?.key === requestKey ? visitedState.value : new Set<HubMode>();

  useEffect(() => {
    const syncMode = () => setActiveMode(modeFromLocation());
    syncMode();
    window.addEventListener('hashchange', syncMode);
    window.addEventListener('popstate', syncMode);
    return () => {
      window.removeEventListener('hashchange', syncMode);
      window.removeEventListener('popstate', syncMode);
    };
  }, []);

  useEffect(() => {
    if (status === 'signed-out') window.location.replace('/login');
  }, [status]);

  useEffect(() => {
    if (!requestKey || !activeMode) return;
    setVisitedState((previous) => {
      const next = previous?.key === requestKey ? new Set(previous.value) : new Set<HubMode>();
      if (next.has(activeMode)) return previous;
      next.add(activeMode);
      return { key: requestKey, value: next };
    });
  }, [activeMode, requestKey]);

  useEffect(() => {
    if (!requestKey) return;

    const controller = new AbortController();
    let disposed = false;
    setStatsState(null);
    setStatsErrorState(null);
    setFlagsState(null);

    (async () => {
      const ready = await whenGlobalReady(
        () => !!window.api?.getWith,
        'window.api (vocabulary hub)',
      );
      if (!ready || disposed) {
        if (!disposed) setStatsErrorState({ key: requestKey, value: true });
        return;
      }

      const [summaryResult, flagsResult] = await Promise.allSettled([
        window.api.getWith<HomeSummaryPayload>(
          '/api/student/home-summary',
          undefined,
          { signal: controller.signal },
        ),
        window.api.getWith<AuthMePayload>(
          '/auth/me',
          undefined,
          { signal: controller.signal },
        ),
      ]);

      if (disposed) return;

      if (summaryResult.status === 'fulfilled') {
        const parsed = parseStats(summaryResult.value);
        if (parsed) setStatsState({ key: requestKey, value: parsed });
        else setStatsErrorState({ key: requestKey, value: true });
      } else if (!(summaryResult.reason instanceof DOMException && summaryResult.reason.name === 'AbortError')) {
        setStatsErrorState({ key: requestKey, value: true });
      }

      // Default-deny: failed/invalid reads leave the gated cards absent.
      if (flagsResult.status === 'fulfilled') {
        setFlagsState({
          key: requestKey,
          value: {
            flashcardEnabled: flagsResult.value?.flashcard_enabled === true,
            d1Enabled: flagsResult.value?.d1_enabled === true,
          },
        });
      }
    })();

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [requestKey]);

  const openMode = useCallback((event: MouseEvent<HTMLAnchorElement>, mode: HubMode) => {
    event.preventDefault();
    try {
      history.pushState(null, '', `#${mode}`);
    } catch {
      window.location.hash = mode;
    }
    setActiveMode(mode);
  }, []);

  // AuthProvider chưa kết luận phiên thì vẫn là trạng thái đang tải; không vẽ
  // số 0 tạm thời vì 0 là dữ liệu có nghĩa, không phải placeholder.
  const statsLoading = !stats && !statsFailed;

  return (
    <div className="shell">
      <header className="vocab-header">
        <p className="eyebrow">Vocabulary</p>
        <h1>Từ vựng <span className="accent">của bạn</span></h1>
        <p className="subtitle">
          Quản lý vốn từ, ôn tập flashcards theo lịch tự động, và luyện tập từ vựng — tất cả trong một trang.
        </p>
      </header>

      <div className="vocab-stats" aria-label="Tổng quan từ vựng" aria-describedby={statsFailed ? 'vocab-stats-error' : undefined}>
        <div className="stat">
          <span className="label">Từ đã thuộc</span>
          <StatValue value={stats?.wordsLearned} unit="từ" loading={statsLoading} unavailable={!!statsFailed} />
        </div>
        <div className="stat heat">
          <span className="label">Từ từng trả lời sai</span>
          <StatValue value={stats?.wordsMissed} unit="từ" loading={statsLoading} unavailable={!!statsFailed} />
        </div>
        <div className="stat">
          <span className="label">Phiên đã luyện</span>
          <StatValue value={stats?.quizSessions} unit="phiên" loading={statsLoading} unavailable={!!statsFailed} />
        </div>
      </div>
      {statsFailed ? (
        <p className="vocab-stats-error" id="vocab-stats-error" role="status">
          Không tải được thống kê từ vựng. Các công cụ học vẫn dùng được.
        </p>
      ) : null}

      <section className="vocab-modes" aria-labelledby="modes-heading" hidden={activeMode !== null}>
        <h2 id="modes-heading">Bắt đầu học từ vựng</h2>
        <div className="modes-grid">
          <ModeCard mode="vocab-topics" href="#" label="Duyệt từ vựng theo chủ đề" title="Từ vựng" description="Duyệt từ vựng IELTS theo chủ đề." icon={<LibraryIcon />} onOpen={openMode} />
          <ModeCard href="/vocabulary/practice" label="Mở Luyện tập từ vựng" title="Luyện tập" description="Kiểm tra tới khi thuộc trọn cả list từ." icon={<PracticeIcon />} />
          {flags?.flashcardEnabled ? (
            <ModeCard mode="flashcards" href="#" label="Mở Flashcards" title="Flashcards" description="Học từ với hệ thống lặp khoảng cách." icon={<LayersIcon />} onOpen={openMode} />
          ) : null}
          {flags && (flags.d1Enabled || flags.flashcardEnabled) ? (
            <ModeCard mode="exercises" href="#" label="Mở Exercises" title="Exercises" description="Luyện tập đa dạng dạng bài." icon={<ExercisesIcon />} onOpen={openMode} />
          ) : null}
          <ModeCard href="/vocabulary/exam" label="Mở Từ vựng luyện thi" title="Luyện thi" description="Từ vựng AWL, TOEIC, THPT theo danh sách đề." icon={<ExamIcon />} />
        </div>
      </section>

      <section className="tab-panel" data-panel="flashcards" id="panel-flashcards" role="tabpanel" aria-labelledby="modes-heading" hidden={activeMode !== 'flashcards'}>
        {requestKey && visited.has('flashcards') ? (
          <VocabModuleMount
            key={`${requestKey}:flashcards`}
            moduleName="flashcards"
            embedded
            accountKey={requestKey}
            id="mount-flashcards"
            className="tab-mount"
          />
        ) : null}
      </section>

      <section className="tab-panel" data-panel="exercises" id="panel-exercises" role="tabpanel" aria-labelledby="modes-heading" hidden={activeMode !== 'exercises'}>
        {requestKey && visited.has('exercises') ? (
          <VocabModuleMount
            key={`${requestKey}:exercises`}
            moduleName="exercises"
            embedded
            accountKey={requestKey}
            id="mount-exercises"
            className="tab-mount"
          />
        ) : null}
      </section>

      <section className="tab-panel" data-panel="vocab-topics" id="panel-vocab-topics" role="tabpanel" aria-labelledby="modes-heading" hidden={activeMode !== 'vocab-topics'}>
        {requestKey ? (
          <TopicsPanel accountKey={requestKey} shouldLoad={visited.has('vocab-topics')} />
        ) : null}
      </section>
    </div>
  );
}
