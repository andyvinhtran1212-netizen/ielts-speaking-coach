'use client';

import { Fragment, useEffect, useState } from 'react';

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
  lesson: number | null;
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
      title: (textValue(raw?.title).startsWith(`${testId} — `) ? textValue(raw?.title).slice(testId.length + 3) : textValue(raw?.title)) || 'Mini Test',
      lesson: /^ILR-RDG-LSN-L\d{2}$/.test(testId) ? Number(testId.slice(-2)) : null,
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
    if (status === 'signed-out') window.location.replace('/login');
  }, [status]);

  const accountKey = status === 'signed-in' && user?.id ? user.id : null;
  return <ReadingMiniTestLibrary accountKey={accountKey} key={accountKey || status} />;
}

function ReadingMiniTestLibrary({ accountKey }: { accountKey: string | null }) {
  const [module, setModule] = useState('');
  const [retryToken, setRetryToken] = useState(0);
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
        const tests = normalizeTests(payload).sort((a, b) => (a.lesson ?? 1000) - (b.lesson ?? 1000) || (a.testId.startsWith('ILR-RDG-DRL-') && b.testId.startsWith('ILR-RDG-DRL-') ? a.testId.localeCompare(b.testId) : 0));
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
  }, [accountKey, module, retryToken]);

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
  const durations = [...durationCounts.keys()].sort((a, b) => a - b);
  const durationLabel = durations.length > 1 ? `${durations[0]}–${durations[durations.length - 1]} phút` : durations.length ? `${durations[0]} phút` : '—';
  const resultText = state.status === 'loading'
    ? 'Đang cập nhật danh sách…'
    : state.status === 'error'
      ? 'Không thể tải danh sách'
      : total !== null && total > shown
        ? `${total} mini test · đang hiển thị ${shown}`
        : `${total} mini test`;

  return (
    <ReadingMiniTestShell
      durationCount={durationLabel}
      totalCount={total ?? '—'}
    >
      <section className="rv-library" aria-labelledby="rv-library-title">
        <header className="rv-library__toolbar">
          <div>
            <p className="rv-kicker">BÀI LUYỆN MỘT ĐOẠN</p>
            <h2 id="rv-library-title">Chọn một mini test</h2>
            <p className="rv-result-count" id="rv-result-count" aria-live="polite">{resultText}</p>
          </div>
          <div className="rv-filters">
            <label>
              Mô-đun
              <select id="filter-module" value={module} onChange={(event) => setModule(event.target.value)}>
                <option value="">Tất cả</option>
                <option value="academic">Academic</option>
                <option value="general_training" disabled>General Training (sắp ra mắt)</option>
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
        <div className="rv-error" id="state-error">Không tải được danh sách bài thi. Vui lòng thử lại. <button type="button" onClick={() => setRetryToken((value) => value + 1)}>Thử lại</button></div>
      ) : null}
      {state.status === 'ready' && state.tests.length ? (
        <div className="rv-grid rv-grid--tests" id="rv-grid">
          {state.tests.map((test, index) => (
            <Fragment key={test.key}>
            {(index === 0 || Boolean(test.lesson) !== Boolean(state.tests[index - 1].lesson)) && <h3 className="rv-mini-group">{test.lesson ? 'Lộ trình bài học · theo thứ tự' : 'Luyện từng dạng bài'}</h3>}
            <a
              aria-label={`Bắt đầu mini test ${test.title}`}
              className="rv-card"
              href={admitCorePlayer('reading_exam', { test_id: test.testId, from: 'mini' })}
              key={test.key}
            >
              <div className="rv-card__top">
                <span className="rv-card__code">{test.lesson ? `BÀI ${String(test.lesson).padStart(2, '0')}` : 'LUYỆN DẠNG BÀI'}</span>
                {test.moduleLabel ? <span className="rv-pill is-brand">{test.moduleLabel}</span> : null}
              </div>
              <h3>{test.title}</h3>
              <small className="rv-card__code">{test.testId}</small>
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
            </a></Fragment>
          ))}
        </div>
      ) : null}
      </section>
    </ReadingMiniTestShell>
  );
}
