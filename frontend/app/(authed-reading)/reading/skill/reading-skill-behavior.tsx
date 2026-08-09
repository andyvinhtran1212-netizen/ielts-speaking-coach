'use client';

import { useEffect, useState } from 'react';

import { useAuth } from '@/lib/auth/auth-provider';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

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
  key: string;
  slug: string;
  title: string;
  excerpt: string;
  difficulty: string | null;
  topic: string | null;
  skillLabel: string | null;
  estimatedMinutes: number | null;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; exercises: Exercise[] }
  | { status: 'error'; message: string };

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function positiveInteger(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : null;
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
    return [{
      key: `${id || slug}-${index}`,
      slug,
      title: textValue(raw?.title) || 'Bài luyện',
      excerpt: textValue(raw?.excerpt),
      difficulty: textValue(raw?.difficulty_level) || null,
      topic: tags[0] || null,
      skillLabel: skill ? (SKILL_LABEL[skill] || skill) : null,
      estimatedMinutes: positiveInteger(raw?.estimated_minutes),
    }];
  });
}

function errorMessage(caught: unknown): string {
  return caught instanceof Error && caught.message ? ` ${caught.message}` : '';
}

export function ReadingSkillBehavior() {
  const { status, user } = useAuth();

  useEffect(() => {
    if (status === 'signed-out') window.location.replace('/login.html');
  }, [status]);

  if (status !== 'signed-in' || !user?.id) {
    return <div className="rv-empty" id="state-loading">Đang tải…</div>;
  }

  return <ReadingSkillLibrary accountKey={user.id} key={user.id} />;
}

function ReadingSkillLibrary({ accountKey }: { accountKey: string }) {
  const [difficulty, setDifficulty] = useState('');
  const [skill, setSkill] = useState('');
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    setState({ status: 'loading' });

    (async () => {
      const ready = await whenGlobalReady(
        () => !!window.api?.getWith,
        'window.api (reading skill)',
      );
      if (!ready || disposed) {
        if (!disposed) setState({ status: 'error', message: '' });
        return;
      }

      const query = new URLSearchParams();
      if (difficulty) query.set('difficulty', difficulty);
      if (skill) query.set('skill', skill);
      query.set('limit', '50');

      try {
        const payload = await window.api.getWith<unknown>(
          `/api/reading/skill?${query.toString()}`,
          undefined,
          { signal: controller.signal },
        );
        if (disposed) return;
        setState({ status: 'ready', exercises: normalizeExercises(payload) });
      } catch (caught: unknown) {
        if (disposed || (caught instanceof DOMException && caught.name === 'AbortError')) return;
        setState({ status: 'error', message: errorMessage(caught) });
      }
    })();

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [accountKey, difficulty, skill]);

  return (
    <>
      <div className="rv-filters">
        <label>
          Trình độ
          <select
            id="filter-difficulty"
            value={difficulty}
            onChange={(event) => setDifficulty(event.target.value)}
          >
            <option value="">Tất cả</option>
            <option value="foundation">Foundation</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
          </select>
        </label>
        <label>
          Kỹ năng
          <select id="filter-skill" value={skill} onChange={(event) => setSkill(event.target.value)}>
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
      </div>

      {state.status === 'loading' ? (
        <div className="rv-empty" id="state-loading">Đang tải…</div>
      ) : null}
      {state.status === 'ready' && !state.exercises.length ? (
        <div className="rv-empty" id="state-empty">Chưa có bài luyện kỹ năng nào khớp bộ lọc.</div>
      ) : null}
      {state.status === 'error' ? (
        <div className="rv-error" id="state-error">Không tải được thư viện.{state.message}</div>
      ) : null}
      {state.status === 'ready' && state.exercises.length ? (
        <div className="rv-grid" id="rv-grid">
          {state.exercises.map((exercise) => (
            <a
              className="rv-card"
              href={`/pages/reading-skill-exercise.html?slug=${encodeURIComponent(exercise.slug)}`}
              key={exercise.key}
            >
              <h3>{exercise.title}</h3>
              <div className="rv-card__excerpt">{exercise.excerpt}</div>
              <div className="rv-meta">
                {exercise.skillLabel ? <span className="rv-pill is-brand">{exercise.skillLabel}</span> : null}
                {exercise.difficulty ? <span className="rv-pill">{exercise.difficulty}</span> : null}
                {exercise.topic ? <span className="rv-pill">{exercise.topic}</span> : null}
                {exercise.estimatedMinutes ? <span className="rv-pill">{exercise.estimatedMinutes}p</span> : null}
              </div>
            </a>
          ))}
        </div>
      ) : null}
    </>
  );
}
