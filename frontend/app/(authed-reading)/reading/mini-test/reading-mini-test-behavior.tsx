'use client';

import { useEffect, useState } from 'react';

import { useAuth } from '@/lib/auth/auth-provider';
import { admitCorePlayer } from '@/lib/core-player-affinity.mjs';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

const MODULE_LABEL: Record<string, string> = {
  academic: 'Academic',
  general_training: 'General Training',
};

interface RawTest {
  id?: unknown;
  test_id?: unknown;
  title?: unknown;
  module?: unknown;
  passage_count?: unknown;
  total_questions?: unknown;
  time_limit_minutes?: unknown;
  band_target?: unknown;
}

interface ReadingMiniTest {
  key: string;
  testId: string;
  title: string;
  moduleLabel: string | null;
  passageCount: number;
  totalQuestions: number;
  timeLimitMinutes: number;
  bandTarget: string | null;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; tests: ReadingMiniTest[] }
  | { status: 'error'; message: string };

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function positiveInteger(value: unknown, fallback: number): number {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : fallback;
}

function displayValue(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return textValue(value) || null;
}

function normalizeTests(payload: unknown): ReadingMiniTest[] {
  const items = payload && typeof payload === 'object'
    ? (payload as { items?: unknown }).items
    : null;
  if (!Array.isArray(items)) return [];

  return items.flatMap((raw: RawTest, index) => {
    const testId = textValue(raw?.test_id);
    if (!testId) return [];
    const id = textValue(raw?.id);
    const module = textValue(raw?.module);
    return [{
      key: `${id || testId}-${index}`,
      testId,
      title: textValue(raw?.title) || 'Full Test',
      moduleLabel: module ? (MODULE_LABEL[module] || module) : null,
      passageCount: positiveInteger(raw?.passage_count, 3),
      totalQuestions: positiveInteger(raw?.total_questions, 40),
      timeLimitMinutes: positiveInteger(raw?.time_limit_minutes, 60),
      bandTarget: displayValue(raw?.band_target),
    }];
  });
}

function errorMessage(caught: unknown): string {
  return caught instanceof Error && caught.message ? ` ${caught.message}` : '';
}

export function ReadingMiniTestBehavior() {
  const { status, user } = useAuth();

  useEffect(() => {
    if (status === 'signed-out') window.location.replace('/login.html');
  }, [status]);

  if (status !== 'signed-in' || !user?.id) {
    return <div className="rv-empty" id="state-loading">Đang tải…</div>;
  }

  return <ReadingMiniTestLibrary accountKey={user.id} key={user.id} />;
}

function ReadingMiniTestLibrary({ accountKey }: { accountKey: string }) {
  const [module, setModule] = useState('');
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    setState({ status: 'loading' });

    (async () => {
      const ready = await whenGlobalReady(
        () => !!window.api?.getWith,
        'window.api (reading mini tests)',
      );
      if (!ready || disposed) {
        if (!disposed) setState({ status: 'error', message: '' });
        return;
      }

      const query = new URLSearchParams();
      if (module) query.set('module', module);
      query.set('limit', '50');
      query.set('test_type', 'mini');

      try {
        const payload = await window.api.getWith<unknown>(
          `/api/reading/test?${query.toString()}`,
          undefined,
          { signal: controller.signal },
        );
        if (disposed) return;
        setState({ status: 'ready', tests: normalizeTests(payload) });
      } catch (caught: unknown) {
        if (disposed || (caught instanceof DOMException && caught.name === 'AbortError')) return;
        setState({ status: 'error', message: errorMessage(caught) });
      }
    })();

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [accountKey, module]);

  return (
    <>
      <div className="rv-filters">
        <label>
          Mô-đun
          <select id="filter-module" value={module} onChange={(event) => setModule(event.target.value)}>
            <option value="">Tất cả</option>
            <option value="academic">Academic</option>
            <option value="general_training" disabled>General Training (Phase B)</option>
          </select>
        </label>
      </div>

      {state.status === 'loading' ? (
        <div className="rv-empty" id="state-loading">Đang tải…</div>
      ) : null}
      {state.status === 'ready' && !state.tests.length ? (
        <div className="rv-empty" id="state-empty">Chưa có mini test nào.</div>
      ) : null}
      {state.status === 'error' ? (
        <div className="rv-error" id="state-error">Không tải được danh sách bài thi.{state.message}</div>
      ) : null}
      {state.status === 'ready' && state.tests.length ? (
        <div className="rv-grid" id="rv-grid">
          {state.tests.map((test) => (
            <a
              className="rv-card"
              href={admitCorePlayer('reading_exam', { test_id: test.testId, from: 'mini' })}
              key={test.key}
            >
              <h3>{test.title}</h3>
              <div className="rv-card__excerpt"><code>{test.testId}</code></div>
              <div className="rv-meta">
                {test.moduleLabel ? <span className="rv-pill is-brand">{test.moduleLabel}</span> : null}
                <span className="rv-pill">{test.passageCount} parts</span>
                <span className="rv-pill">{test.totalQuestions} câu</span>
                <span className="rv-pill">{test.timeLimitMinutes}p</span>
                {test.bandTarget ? <span className="rv-pill">Band {test.bandTarget}</span> : null}
              </div>
            </a>
          ))}
        </div>
      ) : null}
    </>
  );
}
