'use client';

import { useEffect, useRef, useState } from 'react';

import { useSearchParams } from 'next/navigation';
import { readingSkillContext, readingSkillHref, readingSkillArticleHref } from '@/lib/reading-skill-context.mjs';
import { safeImageUrl } from '@/lib/reading-detail-model.mjs';

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
  image_url?: unknown;
  word_count?: unknown;
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
  imageUrl: string | null;
  wordCount: number | null;
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
      imageUrl: safeImageUrl(raw?.image_url),
      wordCount: positiveInteger(raw?.word_count),
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
  const params = useSearchParams();
  const context = readingSkillContext(params || undefined);
  const { difficulty, skill, q, batches } = context;
  const contextHref = readingSkillHref(context);
  const scrollKey = accountKey ? `aver:reading-skill-scroll:v1:${accountKey}:${contextHref}` : null;
  const rememberScroll = () => {
    if (!scrollKey) return;
    try { window.sessionStorage.setItem(scrollKey, String(window.scrollY)); } catch { /* optional */ }
  };
  const cached = useRef<{ key: string; batches: number; exercises: Exercise[]; total: number } | null>(null);
  const changeFilters = (update: { difficulty?: string; skill?: string; q?: string }) => {
    const latest = readingSkillContext(new URLSearchParams(window.location.search));
    window.history.replaceState(null, '', readingSkillHref({ ...latest, ...update, batches: 1 }));
  };
  const loadMore = () => window.history.replaceState(null, '', readingSkillHref({ ...readingSkillContext(new URLSearchParams(window.location.search)), batches: batches + 1 }));
  const [state, setState] = useState<LoadState>({ status: 'loading' });
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
    const filterKey = JSON.stringify([accountKey, difficulty, skill, q]);
    const prior = cached.current?.key === filterKey && cached.current.batches < batches ? cached.current : null;
    if (!prior) setState({ status: 'loading' }); else setLoadingMore(true);
    setLoadMoreError(false);

    (async () => {
      const ready = await whenGlobalReady(
        () => !!window.api?.getWith,
        'window.api (reading skill)',
      );
      if (!ready || disposed) {
        if (!disposed) {
          if (prior) setLoadMoreError(true);
          else setState({ status: 'error' });
          setLoadingMore(false);
        }
        return;
      }

      try {
        let exercises = prior?.exercises || []; let total = prior?.total || 0; let loaded = prior?.batches || 0;
        for (let batch = loaded; batch < batches; batch += 1) {
          const offset = batch * PAGE_SIZE;
          const query = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
          if (difficulty) query.set('difficulty', difficulty);
          if (skill) query.set('skill', skill);
          if (q) query.set('q', q);
          const payload = await window.api.getWith<unknown>(`/api/reading/skill?${query.toString()}`, undefined, { signal: controller.signal });
          if (disposed) return;
          const next = normalizeExercises(payload);
          total = normalizeTotal(payload, offset + next.length);
          exercises = [...exercises, ...next].filter((exercise, index, all) => all.findIndex((candidate) => candidate.slug === exercise.slug) === index);
          loaded = batch + 1;
          if (!next.length || offset + next.length >= total) break;
        }
        cached.current = { key: filterKey, batches: loaded, exercises, total };
        setState({ status: 'ready', exercises, total });
      } catch (caught: unknown) {
        if (disposed || (caught instanceof DOMException && caught.name === 'AbortError')) return;
        if (prior) setLoadMoreError(true);
        else setState({ status: 'error' });
      } finally {
        if (!disposed) setLoadingMore(false);
      }
    })();

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [accountKey, difficulty, skill, q, batches, retryToken]);

  useEffect(() => {
    if (state.status !== 'ready' || loadingMore || !scrollKey) return;
    let saved: number | null = null;
    try { const raw = window.sessionStorage.getItem(scrollKey); if (raw !== null && Number.isFinite(Number(raw)) && Number(raw) >= 0) saved = Number(raw); } catch { /* optional */ }
    const frame = requestAnimationFrame(() => { if (saved !== null) window.scrollTo({ top: saved, behavior: 'instant' }); });
    window.addEventListener('scroll', rememberScroll, { passive: true });
    window.addEventListener('pagehide', rememberScroll);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('scroll', rememberScroll); window.removeEventListener('pagehide', rememberScroll); };
  }, [state, contextHref, loadingMore, scrollKey]);

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
        : `${total} bài luyện · ${focusCount} nhóm kỹ năng đang hiển thị`;
  const hasFilters = Boolean(difficulty || skill || q);

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
            <label>Tìm theo tiêu đề<input type="search" aria-label="Tìm bài luyện" maxLength={100} defaultValue={q} key={q} onKeyDown={(event) => { if (event.key === 'Enter') changeFilters({ q: event.currentTarget.value }); }} onBlur={(event) => { if (event.currentTarget.value.trim() !== q) changeFilters({ q: event.currentTarget.value }); }} /></label>
            <label>
              Trình độ
              <select
                id="filter-difficulty"
                value={difficulty}
                onChange={(event) => changeFilters({ difficulty: event.target.value })}
              >
                <option value="">Tất cả</option>
                <option value="foundation">Foundation</option>
                <option value="intermediate">Intermediate</option>
                <option value="advanced">Advanced</option>
              </select>
            </label>
            <label>
              Kỹ năng
              <select id="filter-skill" value={skill} onChange={(event) => changeFilters({ skill: event.target.value })}>
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
                changeFilters({ difficulty: '', skill: '', q: '' });
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
          <div className="rv-error" id="state-error">Không tải được thư viện. Vui lòng thử lại. <button type="button" onClick={() => setRetryToken((value) => value + 1)}>Thử lại</button></div>
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
                  href={readingSkillArticleHref(exercise.slug, context)}
                  onClick={rememberScroll}
                  key={exercise.key}
                >
                  <div className="rv-card__top">
                    <span className="rv-card__type">SKILL PRACTICE</span>
                    {exercise.estimatedMinutes ? (
                      <span className="rv-card__time">{exercise.estimatedMinutes} PHÚT</span>
                    ) : null}
                  </div>
                  {exercise.imageUrl && <img className="rv-card__image" src={exercise.imageUrl} alt="" loading="lazy" onError={(event) => { event.currentTarget.hidden = true; }} />}
                  <h3 title={exercise.fullTitle}>{exercise.title}</h3>
                  <p className="rv-card__excerpt">{exercise.excerpt}</p>
                  <div className="rv-meta">
                    {exercise.skillLabel ? <span className="rv-pill is-brand">{exercise.skillLabel}</span> : null}
                    {difficulty ? <span className="rv-pill">{difficulty}</span> : null}
                    {exercise.wordCount ? <span className="rv-pill">{exercise.wordCount} từ</span> : null}
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
                  : loadMore()}
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
