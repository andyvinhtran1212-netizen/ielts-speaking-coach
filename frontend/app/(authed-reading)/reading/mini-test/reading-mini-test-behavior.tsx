'use client';

import { useEffect, useState } from 'react';

import { useAuth } from '@/lib/auth/auth-provider';
import { admitCorePlayer } from '@/lib/core-player-affinity.mjs';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

import { ReadingMiniTestShell } from './page-shell';

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
  totalQuestions: number | null;
  timeLimitMinutes: number | null;
  bandTarget: string | null;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; tests: ReadingMiniTest[]; total: number }
  | { status: 'error' };

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function positiveInteger(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : null;
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
      title: textValue(raw?.title) || 'Mini Test',
      moduleLabel: module ? (MODULE_LABEL[module] || module) : null,
      passageCount: positiveInteger(raw?.passage_count) || 1,
      totalQuestions: positiveInteger(raw?.total_questions),
      timeLimitMinutes: positiveInteger(raw?.time_limit_minutes),
      bandTarget: displayValue(raw?.band_target),
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

export function ReadingMiniTestBehavior() {
  const { status, user } = useAuth();

  useEffect(() => {
    if (status === 'signed-out') window.location.replace('/login.html');
  }, [status]);

  const accountKey = status === 'signed-in' && user?.id ? user.id : null;
  return <ReadingMiniTestLibrary accountKey={accountKey} key={accountKey || status} />;
}

function ReadingMiniTestLibrary({ accountKey }: { accountKey: string | null }) {
  const [module, setModule] = useState('');
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    if (!accountKey) {
      setState({ status: 'loading' });
      return undefined;
    }

    const controller = new AbortController();
    let disposed = false;
    setState({ status: 'loading' });

    (async () => {
      const ready = await whenGlobalReady(
        () => !!window.api?.getWith,
        'window.api (reading mini tests)',
      );
      if (!ready || disposed) {
        if (!disposed) setState({ status: 'error' });
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
        const tests = normalizeTests(payload);
        setState({ status: 'ready', tests, total: normalizeTotal(payload, tests.length) });
      } catch (caught: unknown) {
        if (disposed || (caught instanceof DOMException && caught.name === 'AbortError')) return;
        setState({ status: 'error' });
      }
    })();

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [accountKey, module]);

  const shown = state.status === 'ready' ? state.tests.length : 0;
  const total = state.status === 'ready' ? state.total : null;
  const durationCounts = new Map<number, number>();
  if (state.status === 'ready') {
    state.tests.forEach((test) => {
      if (test.timeLimitMinutes) {
        durationCounts.set(test.timeLimitMinutes, (durationCounts.get(test.timeLimitMinutes) || 0) + 1);
      }
    });
  }
  const popularDuration = [...durationCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? null;
  const resultText = state.status === 'loading'
    ? 'Đang cập nhật danh sách…'
    : state.status === 'error'
      ? 'Không thể tải danh sách'
      : total !== null && total > shown
        ? `${total} mini test · đang hiển thị ${shown}`
        : `${total} mini test`;

  return (
    <ReadingMiniTestShell
      durationCount={popularDuration ? `${popularDuration} phút` : '—'}
      totalCount={total ?? '—'}
    >
      <section className="rv-library" aria-labelledby="rv-library-title">
        <header className="rv-library__toolbar">
          <div>
            <p className="rv-kicker">BÀI THI NHỊP NGẮN</p>
            <h2 id="rv-library-title">Chọn một mini test</h2>
            <p className="rv-result-count" id="rv-result-count" aria-live="polite">{resultText}</p>
          </div>
          <div className="rv-filters">
            <label>
              Mô-đun
              <select id="filter-module" value={module} onChange={(event) => setModule(event.target.value)}>
                <option value="">Tất cả</option>
                <option value="academic">Academic</option>
                <option value="general_training" disabled>General Training (Phase B)</option>
              </select>
            </label>
            <button
              className="rv-filter-reset"
              id="clear-filters"
              type="button"
              hidden={!module}
              onClick={() => setModule('')}
            >
              Xóa lọc
            </button>
          </div>
        </header>

      {state.status === 'loading' ? (
        <div className="rv-empty" id="state-loading">Đang chuẩn bị mini test…</div>
      ) : null}
      {state.status === 'ready' && !state.tests.length ? (
        <div className="rv-empty" id="state-empty">Chưa có mini test nào.</div>
      ) : null}
      {state.status === 'error' ? (
        <div className="rv-error" id="state-error">Không tải được danh sách bài thi. Vui lòng thử lại.</div>
      ) : null}
      {state.status === 'ready' && state.tests.length ? (
        <div className="rv-grid rv-grid--tests" id="rv-grid">
          {state.tests.map((test) => (
            <a
              aria-label={`Bắt đầu mini test ${test.title}`}
              className="rv-card"
              href={admitCorePlayer('reading_exam', { test_id: test.testId, from: 'mini' })}
              key={test.key}
            >
              <div className="rv-card__top">
                <span className="rv-card__code">{test.testId || 'MINI TEST'}</span>
                {test.moduleLabel ? <span className="rv-pill is-brand">{test.moduleLabel}</span> : null}
              </div>
              <h3>{test.title}</h3>
              <div className="rv-card__facts" aria-label="Cấu trúc mini test">
                <span><strong>{test.passageCount}</strong> đoạn văn</span>
                <span><strong>{test.totalQuestions ?? '—'}</strong> câu hỏi</span>
                <span><strong>{test.timeLimitMinutes ?? '—'}</strong> phút</span>
              </div>
              <div className="rv-card__footer">
                <span className="rv-card__code">
                  {test.bandTarget ? `MỤC TIÊU BAND ${test.bandTarget}` : 'FOCUSED PRACTICE'}
                </span>
                <span className="rv-card__cta">Bắt đầu mini test <span aria-hidden="true">→</span></span>
              </div>
            </a>
          ))}
        </div>
      ) : null}
      </section>
    </ReadingMiniTestShell>
  );
}
