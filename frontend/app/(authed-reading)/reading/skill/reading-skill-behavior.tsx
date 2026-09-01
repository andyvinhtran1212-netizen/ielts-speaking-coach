'use client';

import { useEffect, useState } from 'react';

import { useAuth } from '@/lib/auth/auth-provider';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

import { ReadingSkillShell } from './page-shell';

const SKILL_LABEL: Record<string, string> = {
  skimming: 'Skimming',
  scanning: 'Scanning',
  detail: 'Detail',
  main_idea: 'Main idea',
  inference: 'Inference',
  vocabulary_in_context: 'Vocab in context',
  reference_cohesion: 'Reference / cohesion',
  writer_view_TFNG: "Writer's view (T/F/NG)",
};

interface RawExercise {
  id?: unknown;
  slug?: unknown;
  title?: unknown;
  excerpt?: unknown;
  difficulty_level?: unknown;
  topic_tags?: unknown;
  skill_focus?: unknown;
  estimated_minutes?: unknown;
}

interface Exercise {
  fullTitle: string;
  key: string;
  slug: string;
  title: string;
  excerpt: string;
  difficulty: string | null;
  skill: string | null;
  topic: string | null;
  skillLabel: string | null;
  estimatedMinutes: number | null;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; exercises: Exercise[]; total: number }
  | { status: 'error' };

const DIFFICULTY_LABEL: Record<string, string> = {
  foundation: 'Foundation',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
};
const PAGE_SIZE = 24;

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function positiveInteger(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : null;
}

function displaySkillTitle(value: unknown): string {
  const raw = textValue(value) || 'Bài luyện';
  const parts = raw.split(/\s+[—·]\s+/).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : raw;
}

function normalizeExercises(payload: unknown): Exercise[] {
  const items = payload && typeof payload === 'object'
    ? (payload as { items?: unknown }).items
    : null;
  if (!Array.isArray(items)) return [];

  return items.flatMap((raw: RawExercise, index) => {
    const slug = textValue(raw?.slug);
    if (!slug) return [];
    const id = textValue(raw?.id);
    const skill = textValue(raw?.skill_focus);
    const tags = Array.isArray(raw?.topic_tags)
      ? raw.topic_tags.map(textValue).filter(Boolean)
      : [];
    const fullTitle = textValue(raw?.title) || 'Bài luyện';
    return [{
      fullTitle,
      key: `${id || slug}-${index}`,
      slug,
      title: displaySkillTitle(fullTitle),
      excerpt: textValue(raw?.excerpt),
      difficulty: textValue(raw?.difficulty_level) || null,
      skill: skill || null,
      topic: tags[0] || null,
      skillLabel: skill ? (SKILL_LABEL[skill] || skill) : null,
      estimatedMinutes: positiveInteger(raw?.estimated_minutes),
    }];
  });
}

function normalizeTotal(payload: unknown, shown: number): number {
  if (!payload || typeof payload !== 'object') return shown;
  const total = (payload as { total?: unknown }).total;
  return typeof total === 'number' && Number.isFinite(total) && total >= 0
    ? total
    : shown;
}

export function ReadingSkillBehavior() {
  const { status, user } = useAuth();

  useEffect(() => {
    if (status === 'signed-out') window.location.replace('/login');
  }, [status]);

  const accountKey = status === 'signed-in' && user?.id ? user.id : null;
  return <ReadingSkillLibrary accountKey={accountKey} key={accountKey || status} />;
}

function ReadingSkillLibrary({ accountKey }: { accountKey: string | null }) {
  const [difficulty, setDifficulty] = useState('');
  const [skill, setSkill] = useState('');
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [offset, setOffset] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    if (!accountKey) {
      setState({ status: 'loading' });
      return undefined;
    }

    const controller = new AbortController();
    let disposed = false;
    if (offset === 0) setState({ status: 'loading' });
    else setLoadingMore(true);
    setLoadMoreError(false);

    (async () => {
      const ready = await whenGlobalReady(
        () => !!window.api?.getWith,
        'window.api (reading skill)',
      );
      if (!ready || disposed) {
        if (!disposed) {
          if (offset > 0) setLoadMoreError(true);
          else setState({ status: 'error' });
          setLoadingMore(false);
        }
        return;
      }

      const query = new URLSearchParams();
      if (difficulty) query.set('difficulty', difficulty);
      if (skill) query.set('skill', skill);
      query.set('limit', String(PAGE_SIZE));
      query.set('offset', String(offset));

      try {
        const payload = await window.api.getWith<unknown>(
          `/api/reading/skill?${query.toString()}`,
          undefined,
          { signal: controller.signal },
        );
        if (disposed) return;
        const exercises = normalizeExercises(payload);
        setState((current) => {
          const prior = offset > 0 && current.status === 'ready' ? current.exercises : [];
          const merged = [...prior, ...exercises].filter((exercise, index, all) =>
            all.findIndex((candidate) => candidate.slug === exercise.slug) === index);
          return { status: 'ready', exercises: merged, total: normalizeTotal(payload, offset + exercises.length) };
        });
      } catch (caught: unknown) {
        if (disposed || (caught instanceof DOMException && caught.name === 'AbortError')) return;
        if (offset > 0) setLoadMoreError(true);
        else setState({ status: 'error' });
      } finally {
        if (!disposed) setLoadingMore(false);
      }
    })();

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [accountKey, difficulty, skill, offset, retryToken]);

  const shown = state.status === 'ready' ? state.exercises.length : 0;
  const total = state.status === 'ready' ? state.total : null;
  const focusCount = state.status === 'ready'
    ? new Set(state.exercises.map((exercise) => exercise.skill).filter(Boolean)).size
    : null;
  const resultText = state.status === 'loading'
    ? 'Đang cập nhật danh sách…'
    : state.status === 'error'
      ? 'Không thể tải danh sách'
      : total !== null && total > shown
        ? `${total} bài luyện · đang hiển thị ${shown} bài thuộc ${focusCount} nhóm kỹ năng`
        : `${total} bài luyện · ${focusCount} nhóm kỹ năng`;
  const hasFilters = Boolean(difficulty || skill);

  return (
    <ReadingSkillShell focusCount={focusCount ?? '—'} totalCount={total ?? '—'}>
      <section className="rv-library" aria-labelledby="rv-library-title">
        <header className="rv-library__toolbar">
          <div>
            <p className="rv-kicker">BÀI LUYỆN THEO KỸ NĂNG</p>
            <h2 id="rv-library-title">Chọn đúng điểm cần cải thiện</h2>
            <p className="rv-result-count" id="rv-result-count" aria-live="polite">
              {resultText}
            </p>
          </div>
          <div className="rv-filters">
            <label>
              Trình độ
              <select
                id="filter-difficulty"
                value={difficulty}
                onChange={(event) => { setDifficulty(event.target.value); setOffset(0); }}
              >
                <option value="">Tất cả</option>
                <option value="foundation">Foundation</option>
                <option value="intermediate">Intermediate</option>
                <option value="advanced">Advanced</option>
              </select>
            </label>
            <label>
              Kỹ năng
              <select id="filter-skill" value={skill} onChange={(event) => { setSkill(event.target.value); setOffset(0); }}>
                <option value="">Tất cả</option>
                <option value="skimming">Skimming</option>
                <option value="scanning">Scanning</option>
                <option value="detail">Detail</option>
                <option value="main_idea">Main idea</option>
                <option value="inference">Inference</option>
                <option value="vocabulary_in_context">Vocab in context</option>
                <option value="reference_cohesion">Reference / cohesion</option>
                <option value="writer_view_TFNG">Writer&apos;s view (T/F/NG)</option>
              </select>
            </label>
            <button
              className="rv-filter-reset"
              id="clear-filters"
              type="button"
              hidden={!hasFilters}
              onClick={() => {
                setDifficulty('');
                setSkill('');
                setOffset(0);
              }}
            >
              Xóa lọc
            </button>
          </div>
        </header>

        {state.status === 'loading' ? (
          <div className="rv-empty" id="state-loading">Đang chuẩn bị bài luyện…</div>
        ) : null}
        {state.status === 'ready' && !state.exercises.length ? (
          <div className="rv-empty" id="state-empty">Chưa có bài luyện kỹ năng nào khớp bộ lọc.</div>
        ) : null}
        {state.status === 'error' ? (
          <div className="rv-error" id="state-error">Không tải được thư viện. Vui lòng thử lại.</div>
        ) : null}
        {state.status === 'ready' && state.exercises.length ? (
          <><div className="rv-grid rv-grid--articles" id="rv-grid">
            {state.exercises.map((exercise) => {
              const difficulty = exercise.difficulty
                ? DIFFICULTY_LABEL[exercise.difficulty] || exercise.difficulty
                : null;
              return (
                <a
                  aria-label={`Luyện bài ${exercise.title}`}
                  className="rv-card"
                  href={`/reading/skill/${encodeURIComponent(exercise.slug)}`}
                  key={exercise.key}
                >
                  <div className="rv-card__top">
                    <span className="rv-card__type">SKILL PRACTICE</span>
                    {exercise.estimatedMinutes ? (
                      <span className="rv-card__time">{exercise.estimatedMinutes} PHÚT</span>
                    ) : null}
                  </div>
                  <h3 title={exercise.fullTitle}>{exercise.title}</h3>
                  <p className="rv-card__excerpt">{exercise.excerpt}</p>
                  <div className="rv-meta">
                    {exercise.skillLabel ? <span className="rv-pill is-brand">{exercise.skillLabel}</span> : null}
                    {difficulty ? <span className="rv-pill">{difficulty}</span> : null}
                    {exercise.topic ? <span className="rv-pill">{exercise.topic}</span> : null}
                  </div>
                  <div className="rv-card__footer">
                    <span className="rv-card__code">ĐỌC + CÂU HỎI</span>
                    <span className="rv-card__cta">Luyện ngay <span aria-hidden="true">→</span></span>
                  </div>
                </a>
              );
            })}
          </div>
          {total !== null && shown < total ? (
            <div className="rv-load-more">
              {loadMoreError ? <p role="alert">Chưa tải được trang tiếp theo.</p> : null}
              <button
                type="button"
                disabled={loadingMore}
                onClick={() => loadMoreError
                  ? setRetryToken((value) => value + 1)
                  : setOffset((current) => current + PAGE_SIZE)}
              >
                {loadingMore ? 'Đang tải…' : loadMoreError ? 'Thử lại' : `Xem thêm (${shown}/${total})`}
              </button>
            </div>
          ) : null}</>
        ) : null}
      </section>
    </ReadingSkillShell>
  );
}
