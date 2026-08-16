'use client';

import { useEffect, useState } from 'react';

import { useAuth } from '@/lib/auth/auth-provider';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

const RANGES = [
  ['7d', '7 ngày'],
  ['30d', '30 ngày'],
  ['all', 'Tất cả'],
] as const;

const MODE_LABELS = {
  mini: 'Bài học / Mini test',
  drill: 'Luyện kỹ năng (drill)',
  full: 'Full test',
  practice: 'Luyện nhanh',
} as const;

type RangeKey = typeof RANGES[number][0];
type ModeKey = keyof typeof MODE_LABELS;

interface ModeMetric {
  count: number;
  scoredCount: number;
  attemptsCount: number;
  avgScore: number | null;
  completion: number | null;
}

interface DayMetric {
  key: string;
  date: string;
  count: number;
  avgScore: number | null;
}

interface RecentAttempt {
  key: string;
  title: string;
  date: string;
  scoreText: string;
  perfect: boolean;
}

interface AnalyticsData {
  totalAttempts: number;
  byMode: Record<ModeKey, ModeMetric>;
  byDay: DayMetric[];
  recentAttempts: RecentAttempt[];
  weakestMode: ModeKey | null;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; data: AnalyticsData }
  | { status: 'error' };

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function finiteNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function nonNegativeNumber(value: unknown): number {
  const number = finiteNumber(value);
  return number !== null && number > 0 ? number : 0;
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeMode(value: unknown): ModeMetric {
  const raw = objectValue(value);
  return {
    count: nonNegativeNumber(raw.count),
    scoredCount: nonNegativeNumber(raw.scored_count),
    attemptsCount: nonNegativeNumber(raw.attempts_count),
    avgScore: finiteNumber(raw.avg_score),
    completion: finiteNumber(raw.completion),
  };
}

function isModeKey(value: string): value is ModeKey {
  return Object.prototype.hasOwnProperty.call(MODE_LABELS, value);
}

function normalizeAnalytics(payload: unknown): AnalyticsData {
  const root = objectValue(payload);
  const rawModes = objectValue(root.by_mode);
  const byMode = Object.fromEntries(
    (Object.keys(MODE_LABELS) as ModeKey[]).map((mode) => [mode, normalizeMode(rawModes[mode])]),
  ) as Record<ModeKey, ModeMetric>;

  const rawDays = Array.isArray(root.by_day) ? root.by_day : [];
  const byDay = rawDays.map((value, index) => {
    const raw = objectValue(value);
    const date = textValue(raw.date);
    return {
      key: `${date || 'day'}-${index}`,
      date,
      count: nonNegativeNumber(raw.count),
      avgScore: finiteNumber(raw.avg_score),
    };
  });

  const rawRecent = Array.isArray(root.recent_attempts) ? root.recent_attempts : [];
  const recentAttempts = rawRecent.map((value, index) => {
    const raw = objectValue(value);
    const type = textValue(raw.type);
    const accuracy = finiteNumber(raw.accuracy);
    const status = textValue(raw.status);
    return {
      key: `${textValue(raw.id) || textValue(raw.test_id) || 'attempt'}-${index}`,
      title: textValue(raw.title) || (isModeKey(type) ? MODE_LABELS[type] : type),
      date: textValue(raw.created_at).slice(0, 10),
      scoreText: accuracy === null
        ? status === 'abandoned' ? 'bỏ dở' : 'đang làm'
        : `${Math.round(accuracy * 100)}%`,
      perfect: accuracy === 1,
    };
  });

  const weakest = textValue(root.weakest_mode);
  return {
    totalAttempts: nonNegativeNumber(root.total_attempts),
    byMode,
    byDay,
    recentAttempts,
    weakestMode: isModeKey(weakest) ? weakest : null,
  };
}

function percent(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`;
}

function overall(data: AnalyticsData) {
  let weightedScore = 0;
  let scoredCount = 0;
  let weightedCompletion = 0;
  let attemptsCount = 0;
  (Object.keys(MODE_LABELS) as ModeKey[]).forEach((mode) => {
    const metric = data.byMode[mode];
    if (metric.avgScore !== null && metric.scoredCount > 0) {
      weightedScore += metric.avgScore * metric.scoredCount;
      scoredCount += metric.scoredCount;
    }
    if (metric.completion !== null && metric.attemptsCount > 0) {
      weightedCompletion += metric.completion * metric.attemptsCount;
      attemptsCount += metric.attemptsCount;
    }
  });
  return {
    average: scoredCount > 0 ? weightedScore / scoredCount : null,
    scoredCount,
    completion: attemptsCount > 0 ? weightedCompletion / attemptsCount : null,
  };
}

function RangeTabs({ range, onChange }: { range: RangeKey; onChange: (range: RangeKey) => void }) {
  return (
    <div className="range-tabs" role="group" aria-label="Khoảng thời gian">
      {RANGES.map(([key, label]) => (
        <button
          className={`range-tab${range === key ? ' is-active' : ''}`}
          data-range={key}
          type="button"
          aria-pressed={range === key}
          onClick={() => onChange(key)}
          key={key}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function AnalyticsSurface({ data }: { data: AnalyticsData }) {
  const summary = overall(data);
  const maxCount = Math.max(1, ...data.byDay.map((day) => day.count));
  return (
    <div id="analytics-surface" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--av-space-6)' }}>
      {data.weakestMode && (
        <div className="weakest-banner" id="weakest-banner">
          Dạng cần luyện thêm: {MODE_LABELS[data.weakestMode]} (điểm thấp nhất trong khoảng này).
        </div>
      )}

      <section className="summary-grid">
        <div className="stat-card">
          <span className="stat-label">Tổng số lượt làm</span>
          <span className="stat-value" id="stat-total">{data.totalAttempts}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Đúng trung bình</span>
          <span className="stat-value" id="stat-avg">{percent(summary.average)}</span>
          <span className="stat-sub" id="stat-avg-sub">
            {summary.average === null ? '' : `trong ${summary.scoredCount} bài đã nộp`}
          </span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Tỷ lệ hoàn thành</span>
          <span className="stat-value" id="stat-acc">{percent(summary.completion)}</span>
        </div>
      </section>

      <section className="section-card">
        <h2>Theo dạng bài</h2>
        <table className="mode-table">
          <thead>
            <tr>
              <th>Dạng</th>
              <th className="num">Số bài</th>
              <th className="num">Đúng TB</th>
              <th className="num">Hoàn thành</th>
            </tr>
          </thead>
          <tbody id="mode-table-body">
            {(Object.keys(MODE_LABELS) as ModeKey[]).map((mode) => {
              const metric = data.byMode[mode];
              return (
                <tr data-mode={mode} key={mode}>
                  <td>{MODE_LABELS[mode]}</td>
                  <td className="num">{metric.count}</td>
                  <td className="num">{percent(metric.avgScore)}</td>
                  <td className="num">{percent(metric.completion)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="section-card">
        <h2>Theo ngày (14 ngày gần nhất)</h2>
        <div className="day-chart" id="day-chart">
          {data.byDay.map((day) => {
            const height = Math.max(4, Math.round((day.count / maxCount) * 100));
            const title = `${day.date} — ${day.count} lượt${
              day.avgScore === null ? '' : `, TB ${Math.round(day.avgScore * 100)}%`
            }`;
            return (
              <div
                className="day-bar"
                style={{ height: `${height}px` }}
                data-has-data={day.count > 0 ? '1' : '0'}
                title={title}
                key={day.key}
              />
            );
          })}
        </div>
        <div className="day-labels" id="day-labels">
          {data.byDay.map((day) => <div key={day.key}>{day.date.slice(5)}</div>)}
        </div>
      </section>

      <section className="section-card">
        <h2>Hoạt động gần đây</h2>
        <ul className="recent-list" id="recent-list">
          {data.recentAttempts.map((attempt) => (
            <li key={attempt.key}>
              <span className="recent-mode">{attempt.title}</span>
              <span style={{ color: 'var(--av-text-muted)', fontFamily: 'var(--av-font-mono)', fontSize: 'var(--av-fs-xs)' }}>
                {attempt.date}
              </span>
              <span className={`recent-score${attempt.perfect ? ' is-perfect' : ''}`}>
                {attempt.scoreText}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function ListeningAnalyticsBehavior() {
  const { status, user } = useAuth();

  useEffect(() => {
    if (status === 'signed-out') window.location.replace('/login');
  }, [status]);

  const accountKey = status === 'signed-in' && user?.id ? user.id : null;
  return <ListeningAnalyticsDashboard accountKey={accountKey} key={accountKey || status} />;
}

function ListeningAnalyticsDashboard({ accountKey }: { accountKey: string | null }) {
  const [range, setRange] = useState<RangeKey>('30d');
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
        'window.api (listening analytics)',
      );
      if (!ready || disposed) {
        if (!disposed) setState({ status: 'error' });
        return;
      }
      try {
        const payload = await window.api.getWith<unknown>(
          `/api/listening/analytics?range=${encodeURIComponent(range)}`,
          undefined,
          { signal: controller.signal },
        );
        if (!disposed) setState({ status: 'ready', data: normalizeAnalytics(payload) });
      } catch (caught: unknown) {
        if (disposed || (caught instanceof DOMException && caught.name === 'AbortError')) return;
        setState({ status: 'error' });
      }
    })();

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [accountKey, range]);

  const changeRange = (nextRange: RangeKey) => {
    if (nextRange === range) return;
    // Hide the previous range synchronously with the selected tab. Waiting for
    // the effect would briefly label stale figures as belonging to nextRange.
    setState({ status: 'loading' });
    setRange(nextRange);
  };

  return (
    <>
      <RangeTabs range={range} onChange={changeRange} />
      {state.status === 'loading' && (
        <div className="empty-state" id="state-loading" role="status">Đang tải…</div>
      )}
      {state.status === 'ready' && state.data.totalAttempts === 0 && (
        <div className="empty-state" id="state-empty" role="status">
          <p><strong>Chưa có dữ liệu luyện tập trong khoảng này.</strong></p>
          <p>Bắt đầu một bài nghe để thấy thống kê.</p>
        </div>
      )}
      {state.status === 'error' && (
        <div className="error-banner" id="state-error" role="alert">
          Không tải được thống kê. Vui lòng thử lại.
        </div>
      )}
      {state.status === 'ready' && state.data.totalAttempts > 0 && (
        <AnalyticsSurface data={state.data} />
      )}
    </>
  );
}
