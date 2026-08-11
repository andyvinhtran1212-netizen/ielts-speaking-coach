'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';

import { useAdminProfile } from '@/components/admin-access-gate';
import {
  chartPoints,
  finiteNumber,
  formatInteger,
  formatTokens,
  normalizeOpsPayload,
  normalizeOverviewPayload,
  normalizeTrendsPayload,
  periodDelta,
  safeActivityLink,
} from '@/lib/admin-overview-model.mjs';

const REFRESH_MS = 5 * 60 * 1000;
type WindowDays = 7 | 30 | 90;
type Pane = 'ops' | 'content';
type SeriesKey = 'practices' | 'visitors' | 'tokens';
type LoadingScope = 'all' | 'windowed' | null;

function messageOf(caught: unknown) {
  return caught instanceof Error ? caught.message : String(caught || 'lỗi không xác định');
}

function formatTimestamp(value: unknown) {
  if (typeof value !== 'string' || !value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('vi-VN', {
    hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit',
  });
}

function formatComputedAt(value: unknown) {
  if (typeof value !== 'string' || !value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('vi-VN');
}

function formatRelative(timestamp: number, now: number) {
  if (!timestamp) return '—';
  const diff = Math.max(0, now - timestamp);
  if (diff < 60_000) return 'vừa cập nhật';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `Cập nhật ${minutes} phút trước`;
  return `Cập nhật ${Math.floor(minutes / 60)} giờ trước`;
}

function moveTabFocus<T extends string>(
  event: KeyboardEvent<HTMLButtonElement>,
  keys: readonly T[],
  current: T,
  select: (key: T) => void,
  idPrefix: string,
) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const currentIndex = Math.max(0, keys.indexOf(current));
  const nextIndex = event.key === 'Home' ? 0
    : event.key === 'End' ? keys.length - 1
      : event.key === 'ArrowRight' ? (currentIndex + 1) % keys.length
        : (currentIndex - 1 + keys.length) % keys.length;
  const next = keys[nextIndex];
  select(next);
  requestAnimationFrame(() => document.getElementById(`${idPrefix}${next}`)?.focus());
}

function Sparkline({ values }: { values: unknown[] }) {
  const points = chartPoints(values, 120, 28, 2) as Array<{ x: number; y: number }>;
  if (points.length < 2) {
    return <svg className="av-spark" viewBox="0 0 120 28" preserveAspectRatio="none" aria-hidden="true" />;
  }
  const last = points[points.length - 1];
  return (
    <svg className="av-spark" viewBox="0 0 120 28" preserveAspectRatio="none" aria-hidden="true">
      <polyline
        className="av-spark__line"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={points.map((point) => `${point.x},${point.y}`).join(' ')}
      />
      <circle className="av-spark__dot" cx={last.x} cy={last.y} r="1.8" fill="currentColor" />
    </svg>
  );
}

function AreaChart({ values, label }: { values: unknown[]; label: string }) {
  const points = chartPoints(values, 640, 160, 6) as Array<{ x: number; y: number }>;
  if (points.length < 2) return <div className="db-trends__empty">Chưa có dữ liệu xu hướng.</div>;
  const line = points.map((point) => `${point.x},${point.y}`).join(' ');
  const area = `M${points[0].x},154 L${points.map((point) => `${point.x},${point.y}`).join(' L')} L${points[points.length - 1].x},154 Z`;
  return (
    <svg className="av-area" viewBox="0 0 640 160" preserveAspectRatio="none" role="img" aria-label={label}>
      <path className="av-area__fill" d={area} fill="currentColor" fillOpacity="0.12" stroke="none" />
      <polyline
        className="av-area__line"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={line}
      />
    </svg>
  );
}

function Delta({ values }: { values: unknown[] }) {
  const delta = periodDelta(values) as { pct: number | null; dir: 'up' | 'down' | 'flat' } | null;
  if (!delta) return null;
  const arrow = delta.dir === 'up' ? '▲' : delta.dir === 'down' ? '▼' : '→';
  return (
    <span className={`db-delta is-${delta.dir}`}>
      {arrow}{delta.pct == null ? '' : ` ${Math.abs(delta.pct)}%`}
    </span>
  );
}

function MetricCard({
  label,
  scope,
  value,
  unit,
  href,
  series,
  loading,
  children,
}: {
  label: string;
  scope?: string;
  value: string;
  unit?: string;
  href: string;
  series?: unknown[];
  loading?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <article className={`db-card${loading ? ' is-loading' : ''}`} aria-busy={loading || undefined}>
      <div className="db-card__label">{label}{scope && <span className="db-card__scope">{scope}</span>}</div>
      <div className="db-card__valrow">
        <span className="db-card__value">{value}</span>
        {unit && <span className="db-card__unit">{unit}</span>}
        {series && <Delta values={series} />}
      </div>
      {children}
      {series && <div className="db-card__spark"><Sparkline values={series} /></div>}
      <a className="db-card__link" href={href}>Xem chi tiết →</a>
    </article>
  );
}

const SKILL_LINKS = {
  speaking: '/pages/admin/speaking/index.html',
  writing: '/pages/admin/writing/index.html',
  listening: '/pages/admin/listening/index.html',
  vocab: '/pages/admin/vocab/index.html',
  grammar: '/pages/admin/grammar/index.html',
};

function SkillCard({ name, children }: { name: keyof typeof SKILL_LINKS; children: React.ReactNode }) {
  const labels = { speaking: 'Speaking', writing: 'Writing', listening: 'Listening', vocab: 'Vocab', grammar: 'Grammar' };
  return (
    <a href={SKILL_LINKS[name]} className="admin-hub-card" data-skill={name}>
      <h3>{labels[name]}</h3>
      <div className="skill-stats">{children}</div>
      <div className="meta"><span className="adm-status-pill is-live">LIVE</span></div>
    </a>
  );
}

function SkillStat({ label, value }: { label: string; value: unknown }) {
  const normalized = finiteNumber(value);
  return (
    <div>
      <span className="stat-label">{label}</span>
      <span className="stat-num">{normalized == null ? '—' : String(value)}</span>
    </div>
  );
}

function ActivityFeed({ data, error }: { data: any[]; error: string | null }) {
  if (error) return <div className="activity-empty" role="alert">Không tải được dữ liệu: {error}</div>;
  if (!data.length) return <div className="activity-empty">Chưa có hoạt động nào trong 30 ngày qua.</div>;
  return (
    <div>
      {data.map((row, index) => {
        const link = safeActivityLink(row.link) as string | null;
        const skill = typeof row.skill === 'string' ? row.skill : '—';
        const skillClass = skill === 'speaking' ? 'is-speaking'
          : skill === 'writing' ? 'is-writing'
            : skill === 'listening' ? 'is-listening' : '';
        const user = typeof row.user_email === 'string' && row.user_email
          ? row.user_email
          : row.user_id ? `${String(row.user_id).slice(0, 8)}…` : 'anon';
        const score = row.score == null ? '—'
          : typeof row.score === 'number' ? row.score.toFixed(1) : String(row.score);
        const content = (
          <>
            <span className="ts">{formatTimestamp(row.timestamp)}</span>
            <span>
              <span className={`skill-chip ${skillClass}`}>{skill}</span>
              <span>{typeof row.action === 'string' && row.action ? row.action : 'Hoạt động'} · {user}</span>
            </span>
            <span className="score">{score}</span>
          </>
        );
        const key = `${String(row.timestamp)}-${String(row.user_id || '')}-${index}`;
        return link
          ? <a className="activity-row" href={link} key={key}>{content}</a>
          : <div className="activity-row is-static" key={key}>{content}</div>;
      })}
    </div>
  );
}

export function AdminOverview() {
  const profile = useAdminProfile();
  const [windowDays, setWindowDays] = useState<WindowDays>(30);
  const [pane, setPane] = useState<Pane>('ops');
  const [seriesKey, setSeriesKey] = useState<SeriesKey>('practices');
  const [ops, setOps] = useState<any>(null);
  const [trends, setTrends] = useState<any>(null);
  const [overview, setOverview] = useState<any>(null);
  const [opsError, setOpsError] = useState<string | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [loadingScope, setLoadingScope] = useState<LoadingScope>('all');
  const [contentLoading, setContentLoading] = useState(true);
  const [clock, setClock] = useState(() => Date.now());
  const opsSequence = useRef(0);
  const contentSequence = useRef(0);
  const loadedAccount = useRef('');
  const selectedWindow = useRef<WindowDays>(30);
  const loadedWindow = useRef<WindowDays>(30);
  const lastContentAt = useRef(0);

  const loadOps = useCallback(async (days: WindowDays, scope: Exclude<LoadingScope, null>) => {
    const requestId = ++opsSequence.current;
    setLoadingScope(scope);
    setOpsError(null);
    if (scope === 'windowed') setTrends(null);
    const [opsResult, trendsResult] = await Promise.allSettled([
      window.api.get<unknown>(`/admin/dashboard/overview?visitors_window=${days}`),
      window.api.get<unknown>(`/admin/dashboard/trends?days=${days}`),
    ]);
    if (requestId !== opsSequence.current) return;
    if (opsResult.status === 'fulfilled') {
      setOps(normalizeOpsPayload(opsResult.value, days));
    } else {
      setOpsError(`Không tải được số liệu: ${messageOf(opsResult.reason)}`);
    }
    if (trendsResult.status === 'fulfilled') {
      setTrends(normalizeTrendsPayload(trendsResult.value));
    } else {
      console.error('[admin-overview] trends fetch failed:', trendsResult.reason);
      setTrends(null);
    }
    setLoadingScope(null);
  }, []);

  const loadContent = useCallback(async () => {
    const requestId = ++contentSequence.current;
    setContentLoading(true);
    setOverviewError(null);
    try {
      const value = await window.api.get<unknown>('/admin/overview');
      if (requestId !== contentSequence.current) return;
      setOverview(normalizeOverviewPayload(value));
      lastContentAt.current = Date.now();
      setClock(Date.now());
    } catch (caught) {
      if (requestId !== contentSequence.current) return;
      console.error('[admin-overview] overview fetch failed:', caught);
      setOverviewError(messageOf(caught));
    } finally {
      if (requestId === contentSequence.current) setContentLoading(false);
    }
  }, []);

  const loadAll = useCallback((scope: Exclude<LoadingScope, null>) => {
    void Promise.all([loadOps(windowDays, scope), loadContent()]);
  }, [loadContent, loadOps, windowDays]);

  useEffect(() => {
    loadedAccount.current = profile.id;
    loadedWindow.current = selectedWindow.current;
    setOps(null);
    setTrends(null);
    setOverview(null);
    lastContentAt.current = 0;
    void Promise.all([
      loadOps(selectedWindow.current, 'all'),
      loadContent(),
    ]);
    return () => {
      opsSequence.current += 1;
      contentSequence.current += 1;
    };
  }, [loadContent, loadOps, profile.id]);

  useEffect(() => {
    selectedWindow.current = windowDays;
    if (loadedAccount.current !== profile.id || loadedWindow.current === windowDays) return;
    loadedWindow.current = windowDays;
    void loadOps(windowDays, 'windowed');
  }, [loadOps, profile.id, windowDays]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const start = () => {
      stop();
      timer = setInterval(() => {
        if (document.visibilityState === 'visible') void loadContent();
      }, REFRESH_MS);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        if (Date.now() - lastContentAt.current >= REFRESH_MS) void loadContent();
        start();
      } else {
        stop();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    if (document.visibilityState === 'visible') start();
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [loadContent, profile.id]);

  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const series = trends?.[seriesKey] || [];
  const skills = overview?.skills || {};
  const students = overview?.students || {};
  const errors = overview?.errors || {};
  const accessCodes = overview?.accessCodes || {};
  const codeMix = accessCodes.by_type || {};
  const anyLoading = loadingScope != null || contentLoading;

  return (
    <main className="overview-shell">
      <header className="overview-header">
        <div>
          <h1>Tổng quan <span className="accent">Quản trị</span></h1>
          <p className="ov-subtitle">Sức khỏe vận hành + hoạt động nội dung của toàn hệ thống.</p>
        </div>
        <div className="ov-controls">
          <div className="db-field">
            <label htmlFor="db-window">Cửa sổ</label>
            <select
              id="db-window"
              value={windowDays}
              onChange={(event) => setWindowDays(Number(event.target.value) as WindowDays)}
            >
              <option value={7}>7 ngày</option>
              <option value={30}>30 ngày</option>
              <option value={90}>90 ngày</option>
            </select>
          </div>
          <button className="db-refresh" type="button" disabled={anyLoading} onClick={() => loadAll('all')}>
            ↻ Tải lại
          </button>
          <span data-testid="last-refresh" className="ov-refresh-label" aria-live="polite">
            {formatRelative(lastContentAt.current, clock)}
          </span>
        </div>
      </header>

      {opsError && <div className="db-banner" role="alert">{opsError}</div>}

      <section className="db-block" aria-labelledby="attention-title">
        <h2 className="db-section-title" id="attention-title">Cần chú ý</h2>
        <div className="db-attention">
          <a className="db-attn-card" href="/pages/admin/error-logs/index.html">
            <span className="db-attn-card__count">{formatInteger(ops?.attention?.errorsUndismissed)}</span>
            <span className="db-attn-card__body">
              <span className="db-attn-card__label">Lỗi chưa xử lý</span>
              <span className="db-attn-card__sub">error_logs chưa dismiss</span>
            </span>
          </a>
          <a className="db-attn-card" href="/pages/admin/writing/instructor-queue.html">
            <span className="db-attn-card__count">{formatInteger(ops?.attention?.writingPending)}</span>
            <span className="db-attn-card__body">
              <span className="db-attn-card__label">Bài viết chờ chấm</span>
              <span className="db-attn-card__sub">writing_essays chưa trả kết quả</span>
            </span>
          </a>
        </div>
      </section>

      <div className="ov-tabs" role="tablist" aria-label="Chế độ xem">
        {(['ops', 'content'] as Pane[]).map((key) => {
          const selected = pane === key;
          return (
            <button
              key={key}
              type="button"
              id={`tab-${key}`}
              className={`ov-tab${selected ? ' is-active' : ''}`}
              role="tab"
              aria-selected={selected}
              aria-controls={`pane-${key}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setPane(key)}
              onKeyDown={(event) => moveTabFocus(event, ['ops', 'content'], pane, setPane, 'tab-')}
            >
              {key === 'ops' ? 'Vận hành' : 'Nội dung'}
            </button>
          );
        })}
      </div>

      <section
        className="ov-pane"
        id="pane-ops"
        role="tabpanel"
        aria-labelledby="tab-ops"
        hidden={pane !== 'ops'}
      >
        <section className="db-grid" aria-label="Số liệu vận hành">
          <MetricCard label="Tổng người dùng" scope="toàn thời gian" value={formatInteger(ops?.totalUsers)} href="/pages/admin/users/index.html" loading={loadingScope === 'all'} />
          <MetricCard label="Mã đã kích hoạt" scope="toàn thời gian" value={formatInteger(ops?.activeCodes)} href="/pages/admin/access-codes/index.html" loading={loadingScope === 'all'} />
          <MetricCard
            label={`Người xem (${ops?.visitors?.windowDays ?? windowDays} ngày)`}
            value={formatInteger(ops?.visitors?.count)}
            href="/pages/admin/foot-traffic/index.html"
            series={trends?.visitors || []}
            loading={loadingScope != null}
          >
            <div className="db-card__split">
              {ops?.visitors?.authenticated == null && ops?.visitors?.anonymous == null
                ? ''
                : `${formatInteger(ops?.visitors?.authenticated)} đăng nhập · ${formatInteger(ops?.visitors?.anonymous)} lượt ẩn danh`}
            </div>
          </MetricCard>
          <MetricCard label="Bài practice đã hoàn thành" scope="toàn thời gian" value={formatInteger(ops?.totalPractices)} href="/pages/admin/usage/index.html" series={trends?.practices || []} loading={loadingScope === 'all'} />
          <MetricCard label="Phút chấm" scope="tích lũy" value={formatInteger(ops?.gradingMinutes)} unit="phút" href="/pages/admin/usage/index.html" loading={loadingScope === 'all'} />
          <MetricCard label={`Token đã gọi (${ops?.tokens?.windowDays ?? windowDays} ngày)`} value={formatTokens(ops?.tokens?.count)} href="/pages/admin/system/ai-usage.html" series={trends?.tokens || []} loading={loadingScope != null} />
        </section>

        <section className={`db-trends${loadingScope ? ' is-loading' : ''}`} aria-label="Xu hướng theo ngày" aria-busy={loadingScope != null || undefined}>
          <div className="db-trends__head">
            <h2 className="db-trends__title">Xu hướng theo ngày</h2>
            <div className="db-trends__tabs" role="tablist" aria-label="Chỉ số xu hướng">
              {(['practices', 'visitors', 'tokens'] as SeriesKey[]).map((key) => {
                const selected = seriesKey === key;
                const labels = { practices: 'Practice', visitors: 'Người xem', tokens: 'Token' };
                return (
                  <button
                    key={key}
                    type="button"
                    id={`trend-tab-${key}`}
                    className={`db-trend-tab${selected ? ' is-active' : ''}`}
                    role="tab"
                    aria-selected={selected}
                    aria-controls="trend-panel"
                    tabIndex={selected ? 0 : -1}
                    onClick={() => setSeriesKey(key)}
                    onKeyDown={(event) => moveTabFocus(
                      event,
                      ['practices', 'visitors', 'tokens'],
                      seriesKey,
                      setSeriesKey,
                      'trend-tab-',
                    )}
                  >
                    {labels[key]}
                  </button>
                );
              })}
            </div>
          </div>
          <div
            className="db-trends__chart"
            id="trend-panel"
            role="tabpanel"
            aria-labelledby={`trend-tab-${seriesKey}`}
          >
            <AreaChart values={series} label={`Xu hướng ${seriesKey} trong ${windowDays} ngày`} />
          </div>
        </section>
        <p className="db-foot">{ops?.computedAt ? `Cập nhật lúc ${formatComputedAt(ops.computedAt)}` : ''}</p>
      </section>

      <section
        className="ov-pane"
        id="pane-content"
        role="tabpanel"
        aria-labelledby="tab-content"
        hidden={pane !== 'content'}
      >
        <section className="stat-grid" aria-label="Số liệu học viên" aria-busy={contentLoading || undefined}>
          <div className="stat-tile">
            <span className="label">Tổng học viên</span>
            <span className="value">{formatInteger(students.total)}</span>
            <span className="delta">{finiteNumber(students.active_30d) == null ? '—' : `${formatInteger(students.active_30d)} hoạt động trong 30 ngày`}</span>
          </div>
          <div className="stat-tile">
            <span className="label">Đang hoạt động (7 ngày)</span>
            <span className="value">{formatInteger(students.active_7d)}</span>
            <span className="delta">{finiteNumber(students.active_30d) == null ? '—' : `${formatInteger(students.active_30d)} trong 30 ngày`}</span>
          </div>
          <a className={`stat-tile is-clickable${Number(errors.undismissed || 0) > 0 ? ' is-warning' : ''}`} href="/pages/admin/error-logs/index.html">
            <span className="label">Lỗi chưa xử lý</span>
            <span className="value">{formatInteger(errors.undismissed)}</span>
            <span className="delta">{finiteNumber(errors.last_24h) == null ? '—' : `${formatInteger(errors.last_24h)} trong 24h qua`}</span>
          </a>
          <a className="stat-tile is-clickable" href="/pages/admin/access-codes/index.html">
            <span className="label">Mã đang dùng</span>
            <span className="value">{formatInteger(accessCodes.active)}</span>
            <span className="delta">Đại trà {formatInteger(codeMix.mass || 0)} · Trực tiếp {formatInteger(codeMix.direct || 0)} · NV {formatInteger(codeMix.staff || 0)}</span>
          </a>
        </section>

        <div>
          <h2 className="ov-section-title">Hoạt động theo kỹ năng</h2>
          <section className="skill-grid" aria-label="Tóm tắt theo kỹ năng">
            <SkillCard name="speaking">
              <SkillStat label="7 ngày" value={skills.speaking?.sessions_7d} />
              <SkillStat label="Tổng" value={skills.speaking?.sessions_total} />
              <SkillStat label="Band TB" value={finiteNumber(skills.speaking?.avg_band_7d) == null ? '—' : Number(skills.speaking.avg_band_7d).toFixed(1)} />
            </SkillCard>
            <SkillCard name="writing">
              <SkillStat label="7 ngày" value={skills.writing?.essays_7d} />
              <SkillStat label="Tổng" value={skills.writing?.essays_total} />
              <SkillStat label="Chờ chấm" value={skills.writing?.feedback_pending} />
            </SkillCard>
            <SkillCard name="listening">
              <SkillStat label="7 ngày" value={skills.listening?.attempts_7d} />
              <SkillStat label="Tổng" value={skills.listening?.attempts_total} />
              <SkillStat label="Đúng TB" value={finiteNumber(skills.listening?.avg_score_7d) == null ? '—' : `${Math.round(Number(skills.listening.avg_score_7d) * 100)}%`} />
              <SkillStat label="Chép ch.tả 7d" value={skills.listening?.dictation_7d} />
            </SkillCard>
            <SkillCard name="vocab">
              <SkillStat label="Đang học" value={skills.vocab?.due_review_today} />
              <SkillStat label="Tổng" value={skills.vocab?.words_total} />
            </SkillCard>
            <SkillCard name="grammar"><SkillStat label="Đề xuất 7d" value={skills.grammar?.articles_viewed_7d} /></SkillCard>
            <a href="/pages/admin/mock-tests/index.html" className="admin-hub-card">
              <h3>Thi thử (Mock Test) — 4 kỹ năng</h3>
              <div className="skill-stats"><div><span className="stat-label">Quản lý đề · phòng thi trực tiếp · duyệt bài · chấm Writing — trong một khu</span></div></div>
              <div className="meta"><span className="adm-status-pill is-live">LIVE</span></div>
            </a>
          </section>
        </div>

        <div>
          <h2 className="ov-section-title">Hoạt động gần đây</h2>
          <div className="activity-feed" aria-busy={contentLoading || undefined}>
            {contentLoading && !overview
              ? <div className="activity-loading" role="status">Đang tải…</div>
              : <ActivityFeed data={overview?.recentActivity || []} error={overviewError} />}
          </div>
        </div>

        <div>
          <h2 className="ov-section-title">Truy cập + Hệ thống</h2>
          <div className="placeholder-row">
            <a href="/pages/admin/classes/index.html?tab=students">Học viên · LIVE</a>
            <a href="/pages/admin/users/index.html">Tất cả người dùng · LIVE</a>
            <a href="/admin/system">Hệ thống · LIVE</a>
            <a href="/pages/admin/dashboard/reading-attempts.html">Reading — Lượt làm bài · LIVE</a>
            <a href="/pages/admin/classes/index.html">Lớp &amp; Học viên</a>
            <a href="/pages/admin/usage/index.html">Usage logs · Phase B</a>
          </div>
        </div>
      </section>
    </main>
  );
}
