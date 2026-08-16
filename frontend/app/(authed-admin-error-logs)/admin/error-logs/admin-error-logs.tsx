'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useAdminProfile } from '@/components/admin-access-gate';
import {
  finiteNumber,
  formatLogTime,
  formatWindow,
  humanizeError,
  normalizeLogsPayload,
  normalizeMigrationPayload,
  normalizeRollbackPayload,
  normalizeStatsPayload,
  truncate,
} from '@/lib/admin-error-logs-model.mjs';

const PAGE_SIZE = 50;

type ErrorRow = {
  id: string;
  level: 'error' | 'warning' | 'info';
  source: 'frontend' | 'backend';
  message: string;
  stack: string | null;
  url: string | null;
  user_id: string | null;
  user_agent: string | null;
  request_id: string | null;
  occurred_at: string | null;
  dismissed_at: string | null;
  extra: Record<string, unknown> | null;
};

type Filters = {
  dismissed: '' | 'true' | 'false';
  level: '' | 'error' | 'warning' | 'info';
  source: '' | 'frontend' | 'backend';
};

type Stats = { total: number | null; undismissed: number | null; last24h: number | null; last7d: number | null };
type Banner = { kind: 'success' | 'error'; text: string } | null;

const EMPTY_STATS: Stats = { total: null, undismissed: null, last24h: null, last7d: null };

function messageOf(caught: unknown) {
  return caught instanceof Error ? caught.message : String(caught || 'lỗi không xác định');
}

function formatInteger(value: number | null) {
  return value == null ? '—' : value.toLocaleString('vi-VN');
}

function toneClass(tone: string) {
  return tone === 'error' ? ' is-error'
    : tone === 'warning' ? ' is-warning'
      : tone === 'muted' ? ' is-muted' : '';
}

function StatusChip({ dismissed }: { dismissed: boolean }) {
  return <span className={`el-chip${dismissed ? '' : ' is-warning'}`}>{dismissed ? 'Đã xử lý' : 'Chưa xử lý'}</span>;
}

function CategoryChip({ category, tone }: { category: string; tone: string }) {
  return <span className={`el-chip${toneClass(tone)}`}>{category}</span>;
}

function ErrorDetail({ row, pending, onDismiss, onUndismiss }: {
  row: ErrorRow;
  pending: boolean;
  onDismiss: (id: string) => void;
  onUndismiss: (id: string) => void;
}) {
  const summary = humanizeError(row);
  return (
    <div className="el-detail">
      <div><strong>Tóm tắt:</strong> <CategoryChip category={summary.category} tone={summary.tone} /> {summary.summary}</div>
      <div><strong>Message gốc:</strong> <code>{row.message || '(none)'}</code></div>
      <div><strong>Request ID:</strong> <code>{row.request_id || '(none)'}</code></div>
      <div><strong>User:</strong> <code>{row.user_id || '(anonymous)'}</code></div>
      <div><strong>User-Agent:</strong> <code>{row.user_agent || '(none)'}</code></div>
      <div><strong>Stack:</strong><pre>{row.stack || '(no stack)'}</pre></div>
      <div><strong>Extra:</strong><pre>{row.extra ? JSON.stringify(row.extra, null, 2) : '(none)'}</pre></div>
      <div className="el-detail__actions">
        {row.dismissed_at
          ? <button className="btn-secondary" type="button" disabled={pending} onClick={() => onUndismiss(row.id)}>{pending ? 'Đang lưu…' : 'Reset (undo)'}</button>
          : <button className="btn-primary" type="button" disabled={pending} onClick={() => onDismiss(row.id)}>{pending ? 'Đang lưu…' : 'Đánh dấu xử lý'}</button>}
      </div>
    </div>
  );
}

function VerdictLine({ label, verdict }: { label: string; verdict: any }) {
  if (!verdict) return null;
  const status = typeof verdict.status === 'string' ? verdict.status : '—';
  let detail = '';
  if (verdict.basis === 'relative') {
    detail = `delta ${verdict.delta_x != null ? `${verdict.delta_x}×` : '∞'} (ngưỡng ${verdict.threshold_x}×, baseline ${verdict.baseline_source})`;
  } else if (verdict.basis === 'absolute') {
    detail = 'so ngưỡng tuyệt đối (không có baseline tương đối)';
  } else if (status === 'insufficient-sample') {
    detail = 'mẫu chưa đủ — chưa kết luận được';
  }
  return (
    <div className={`el-note${status === 'breach' ? ' is-warning' : ''}`}>
      <strong>{label}:</strong> {status}{detail ? ` — ${detail}` : ''}
    </div>
  );
}

function ExposureLine({ metrics }: { metrics: any }) {
  const exposure = metrics?.exposure;
  if (!exposure || exposure.evaluated_views == null) return null;
  const by = exposure.by_implementation && typeof exposure.by_implementation === 'object'
    ? exposure.by_implementation : {};
  const others = ['legacy', 'untagged']
    .filter((key) => finiteNumber(by[key]))
    .map((key) => `${key} ${by[key]}`)
    .join(', ');
  return (
    <>
      {metrics.windowClamped && (
        <div className="el-note is-warning">
          <strong>⚠ Cửa sổ bị cắt:</strong> yêu cầu {metrics.requestedWindowMinutes} phút,
          thực tế tính {metrics.windowMinutes} phút (trần bảng {String(metrics.windows?.table_max ?? '—')} phút).
          Con số dưới đây không thuộc cửa sổ đã yêu cầu.
        </div>
      )}
      <div className={`el-note${exposure.exact ? '' : ' is-warning'}`}>
        <strong>Phơi nhiễm luỹ kế ({String(exposure.evaluated_implementation || 'next')}):</strong>{' '}
        {exposure.exact ? '' : 'ít nhất '}{String(exposure.evaluated_views)} lượt xem trong {formatWindow(metrics.windowMinutes)}
        {' — '}vế số-lượng của sàn §12.3
        {others ? `. Không tính vào sàn: ${others}` : ''}
        {exposure.exact ? '' : '. Đếm chính xác không chạy được — đây là cận dưới.'}
      </div>
    </>
  );
}

export function AdminErrorLogs() {
  const profile = useAdminProfile();
  const [filters, setFilters] = useState<Filters>({ dismissed: 'false', level: '', source: '' });
  const [hideNoise, setHideNoise] = useState(true);
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<ErrorRow[]>([]);
  const [stats, setStats] = useState<Stats>(EMPTY_STATS);
  const [migration, setMigration] = useState<any>(null);
  const [rollback, setRollback] = useState<any>(null);
  const [routeValue, setRouteValue] = useState('/');
  const [matchMode, setMatchMode] = useState<'exact' | 'prefix'>('exact');
  const [windowMinutes, setWindowMinutes] = useState('30');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pendingRows, setPendingRows] = useState<Set<string>>(new Set());
  const [logsLoading, setLogsLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [migrationLoading, setMigrationLoading] = useState(true);
  const [rollbackLoading, setRollbackLoading] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [migrationError, setMigrationError] = useState<string | null>(null);
  const [rollbackError, setRollbackError] = useState<string | null>(null);
  const [banner, setBanner] = useState<Banner>(null);
  const logsSequence = useRef(0);
  const statsSequence = useRef(0);
  const migrationSequence = useRef(0);
  const rollbackSequence = useRef(0);
  const testTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestQuery = useRef({ filters, offset });
  latestQuery.current = { filters, offset };

  const visibleRows = useMemo(
    () => hideNoise ? rows.filter((row) => !humanizeError(row).noise) : rows,
    [hideNoise, rows],
  );

  const loadStats = useCallback(async () => {
    const requestId = ++statsSequence.current;
    setStatsLoading(true);
    setStatsError(null);
    try {
      const payload = normalizeStatsPayload(await window.api.get<unknown>('/admin/error-logs/stats')) as Stats;
      if (requestId === statsSequence.current) setStats(payload);
    } catch (caught) {
      if (requestId === statsSequence.current) setStatsError(messageOf(caught));
    } finally {
      if (requestId === statsSequence.current) setStatsLoading(false);
    }
  }, []);

  const loadMigration = useCallback(async () => {
    const requestId = ++migrationSequence.current;
    setMigrationLoading(true);
    setMigrationError(null);
    try {
      const payload = normalizeMigrationPayload(await window.api.get<unknown>('/admin/error-logs/migration-stats'));
      if (requestId === migrationSequence.current) setMigration(payload);
    } catch (caught) {
      if (requestId === migrationSequence.current) setMigrationError(messageOf(caught));
    } finally {
      if (requestId === migrationSequence.current) setMigrationLoading(false);
    }
  }, []);

  const loadLogs = useCallback(async (nextFilters: Filters, nextOffset: number) => {
    const requestId = ++logsSequence.current;
    setLogsLoading(true);
    setLogsError(null);
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(nextOffset) });
    if (nextFilters.dismissed) params.set('dismissed', nextFilters.dismissed);
    if (nextFilters.level) params.set('level', nextFilters.level);
    if (nextFilters.source) params.set('source', nextFilters.source);
    try {
      const payload = normalizeLogsPayload(
        await window.api.get<unknown>(`/admin/error-logs?${params}`),
        PAGE_SIZE,
        nextOffset,
      );
      if (requestId !== logsSequence.current) return;
      setRows(payload.items as ErrorRow[]);
      setExpanded(new Set());
    } catch (caught) {
      if (requestId !== logsSequence.current) return;
      setRows([]);
      setLogsError(messageOf(caught));
    } finally {
      if (requestId === logsSequence.current) setLogsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (testTimer.current) {
      clearTimeout(testTimer.current);
      testTimer.current = null;
    }
    setTestLoading(false);
    setStats(EMPTY_STATS);
    setMigration(null);
    setRollback(null);
    setBanner(null);
    void loadStats();
    void loadMigration();
    return () => {
      statsSequence.current += 1;
      migrationSequence.current += 1;
      rollbackSequence.current += 1;
    };
  }, [profile.id, loadMigration, loadStats]);

  useEffect(() => {
    void loadLogs(filters, offset);
    return () => { logsSequence.current += 1; };
  }, [profile.id, filters, offset, loadLogs]);

  useEffect(() => () => {
    if (testTimer.current) clearTimeout(testTimer.current);
  }, []);

  const updateFilter = (key: keyof Filters, value: string) => {
    setOffset(0);
    setFilters((current) => ({ ...current, [key]: value } as Filters));
  };

  const refreshAll = async () => {
    setBanner(null);
    await Promise.all([loadLogs(filters, offset), loadStats(), loadMigration()]);
  };

  const runRowMutation = async (id: string, action: 'dismiss' | 'undismiss') => {
    if (pendingRows.has(id)) return;
    setPendingRows((current) => new Set(current).add(id));
    try {
      await window.api.post(`/admin/error-logs/${encodeURIComponent(id)}/${action}`, {});
      setBanner({ kind: 'success', text: action === 'dismiss' ? 'Đã đánh dấu xử lý.' : 'Đã reset.' });
      const latest = latestQuery.current;
      await Promise.all([loadLogs(latest.filters, latest.offset), loadStats(), loadMigration()]);
    } catch (caught) {
      setBanner({ kind: 'error', text: `${action === 'dismiss' ? 'Không xử lý được' : 'Không reset được'}: ${messageOf(caught)}` });
    } finally {
      setPendingRows((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  };

  const generateTestError = async () => {
    if (testLoading) return;
    setTestLoading(true);
    setHideNoise(false);
    setBanner({ kind: 'success', text: 'Đang tạo lỗi test… một dòng “Thử nghiệm” sẽ xuất hiện trong giây lát.' });
    try {
      await window.api.post('/admin/error-logs/test?error_type=exception', {});
    } catch {
      // Expected: the backend raises deliberately so the global exception path records the row.
    } finally {
      if (testTimer.current) clearTimeout(testTimer.current);
      testTimer.current = setTimeout(() => {
        const latest = latestQuery.current;
        void Promise.all([loadLogs(latest.filters, latest.offset), loadStats(), loadMigration()]).finally(() => setTestLoading(false));
      }, 800);
    }
  };

  const loadRollback = async () => {
    const requestId = ++rollbackSequence.current;
    setRollbackLoading(true);
    setRollbackError(null);
    setRollback(null);
    const route = routeValue.trim() || '/';
    const params = new URLSearchParams({ route, window_minutes: windowMinutes, match: matchMode });
    try {
      const payload = normalizeRollbackPayload(
        await window.api.get<unknown>(`/admin/error-logs/rollback-metrics?${params}`),
      );
      if (requestId === rollbackSequence.current) setRollback(payload);
    } catch (caught) {
      if (requestId === rollbackSequence.current) setRollbackError(messageOf(caught));
    } finally {
      if (requestId === rollbackSequence.current) setRollbackLoading(false);
    }
  };

  const anyLoading = logsLoading || statsLoading || migrationLoading;
  const serving = typeof window !== 'undefined' ? (window as any).__AVER_RUNTIME_CONFIG__ || {} : {};

  return (
    <main className="el-shell">
      <header className="el-header">
        <div>
          <p className="el-eyebrow">Vận hành hệ thống</p>
          <h1>Báo lỗi</h1>
          <p className="subtitle">Frontend + backend exception log. Đánh dấu xử lý sau khi triage.</p>
        </div>
        <div className="el-header__actions">
          <button className="btn-secondary" type="button" disabled={testLoading} onClick={generateTestError}>
            {testLoading ? 'Đang tạo…' : 'Tạo lỗi test'}
          </button>
          <button className="btn-primary" type="button" disabled={anyLoading} onClick={() => void refreshAll()}>
            {anyLoading ? 'Đang tải…' : 'Tải lại'}
          </button>
        </div>
      </header>

      {banner && <div className={`el-banner is-${banner.kind}`} role={banner.kind === 'error' ? 'alert' : 'status'}>{banner.text}</div>}

      <section className="el-stats-grid" aria-label="Tổng quan báo lỗi" aria-busy={statsLoading || undefined}>
        {[
          ['Tổng số', stats.total, 'total'],
          ['Chưa xử lý', stats.undismissed, 'undismissed'],
          ['24 giờ qua', stats.last24h, 'last-24h'],
          ['7 ngày qua', stats.last7d, 'last-7d'],
        ].map(([label, value, key]) => (
          <article className={`el-stat-card${key === 'undismissed' && value != null && Number(value) > 0 ? ' is-warning' : ''}`} key={String(key)} data-stat={key}>
            <span className="label">{label}</span>
            <strong className="value">{statsLoading ? '…' : formatInteger(value as number | null)}</strong>
          </article>
        ))}
      </section>
      {statsError && <div className="el-inline-error" role="alert">Không tải được thống kê: {statsError}</div>}

      <section className="el-panel" aria-labelledby="migration-title" aria-busy={migrationLoading || undefined}>
        <div className="el-panel__head">
          <div>
            <p className="el-eyebrow">ADR-012</p>
            <h2 id="migration-title">Lỗi 7 ngày theo implementation/release</h2>
          </div>
          {serving.release && <span className="el-serving">Đang phục vụ: {String(serving.release).slice(0, 8)}{serving.environment ? ` · ${serving.environment}` : ''}</span>}
        </div>
        {migrationLoading ? <div className="el-state" role="status">Đang tải migration stats…</div>
          : migrationError ? <div className="el-inline-error" role="alert">Không tải được migration-stats: {migrationError}</div>
            : migration?.rows?.length ? (
              <div className="el-table-scroll">
                <table className="el-compact-table">
                  <thead><tr><th>Implementation</th><th>Release</th><th>Tổng</th><th>Chưa xử lý</th><th>Theo level</th></tr></thead>
                  <tbody>{migration.rows.map((row: any) => (
                    <tr key={`${row.implementation}-${row.release}`}>
                      <td><code>{row.implementation}</code></td><td><code>{row.release}</code></td>
                      <td>{row.total}</td><td>{row.undismissed}</td>
                      <td>{row.byLevel.map(([level, count]: [string, unknown]) => `${level} ${count}`).join(' · ') || '—'}</td>
                    </tr>
                  ))}</tbody>
                </table>
                {migration.truncated && <div className="el-note is-warning">⚠ Dữ liệu bị cắt ở {migration.scanned} dòng.</div>}
              </div>
            ) : <div className="el-state">Chưa có lỗi nào trong {migration?.windowDays || 7} ngày qua.</div>}
      </section>

      <section className="el-panel" aria-labelledby="rollback-title">
        <div className="el-panel__head">
          <div><p className="el-eyebrow">Freeze §4</p><h2 id="rollback-title">Rollback trigger theo route</h2></div>
        </div>
        <div className="el-filter-grid el-filter-grid--rollback">
          <label className="el-field"><span>Route</span><input value={routeValue} onChange={(event) => setRouteValue(event.target.value)} /></label>
          <label className="el-field"><span>Khớp</span><select value={matchMode} onChange={(event) => setMatchMode(event.target.value as 'exact' | 'prefix')}><option value="exact">Chính xác</option><option value="prefix">Cả route con (/x + /x/…)</option></select></label>
          <label className="el-field"><span>Cửa sổ (bảng)</span><select value={windowMinutes} onChange={(event) => setWindowMinutes(event.target.value)}><option value="30">30 phút</option><option value="1440">24 giờ</option><option value="10080">7 ngày</option><option value="43200">30 ngày</option></select></label>
          <button className="btn-secondary el-measure" type="button" disabled={rollbackLoading} onClick={() => void loadRollback()}>{rollbackLoading ? 'Đang đo…' : 'Đo'}</button>
        </div>
        {rollbackError && <div className="el-inline-error" role="alert">Không tải được rollback-metrics: {rollbackError}</div>}
        {!rollback && !rollbackLoading && !rollbackError && <div className="el-state">Chọn route rồi bấm “Đo”.</div>}
        {rollback && (
          <div className="el-rollback-result">
            <div className={`el-note${rollback.matchCoercedFrom ? ' is-warning' : ''}`}>
              Phạm vi: <strong>{rollback.route}</strong> — {rollback.match === 'prefix' ? 'tính cả route con' : 'khớp chính xác đường dẫn'}.
              {rollback.matchCoercedFrom ? ` ⚠ Đã bỏ chế độ “${rollback.matchCoercedFrom}”: route gốc “/” chỉ đo chính nó.` : ''}
            </div>
            <div className="el-table-scroll">
              <table className="el-compact-table">
                <thead><tr><th>Impl</th><th>Views</th><th>Lỗi</th><th>Error rate</th><th>LCP p75</th><th>CLS p75</th><th>INP p75</th></tr></thead>
                <tbody>{['next', 'legacy', 'untagged'].filter((key) => rollback.implementations[key]).map((key) => {
                  const item = rollback.implementations[key] || {};
                  const vitals = item.vitals || {};
                  return <tr key={key}><td><code>{key}</code></td><td>{item.page_views ?? 0}</td><td>{item.errors ?? 0}</td><td>{item.error_rate != null ? `${(Number(item.error_rate) * 100).toFixed(2)}%` : '—'}</td><td>{vitals.lcp_p75 != null ? `${vitals.lcp_p75}ms (n=${vitals.samples ?? 0})` : '—'}</td><td>{vitals.cls_p75 ?? '—'}</td><td>{vitals.inp_p75 != null ? `${vitals.inp_p75}ms` : '—'}</td></tr>;
                })}</tbody>
              </table>
            </div>
            <ExposureLine metrics={rollback} />
            <VerdictLine label="Error-rate (>2×/30ph)" verdict={rollback.errorVerdict} />
            <VerdictLine label="LCP p75 (>1.5×/24h)" verdict={rollback.vitalsVerdict} />
            {rollback.truncated && <div className="el-note is-warning">⚠ Dữ liệu quét bị cắt.</div>}
          </div>
        )}
      </section>

      <section className="el-panel el-log-panel" aria-labelledby="logs-title">
        <div className="el-panel__head"><div><p className="el-eyebrow">Triage</p><h2 id="logs-title">Danh sách báo lỗi</h2></div></div>
        <div className="el-filter-grid">
          <label className="el-field"><span>Trạng thái</span><select value={filters.dismissed} onChange={(event) => updateFilter('dismissed', event.target.value)}><option value="false">Chưa xử lý</option><option value="true">Đã xử lý</option><option value="">Tất cả</option></select></label>
          <label className="el-field"><span>Mức độ</span><select value={filters.level} onChange={(event) => updateFilter('level', event.target.value)}><option value="">Tất cả</option><option value="error">error</option><option value="warning">warning</option><option value="info">info</option></select></label>
          <label className="el-field"><span>Nguồn</span><select value={filters.source} onChange={(event) => updateFilter('source', event.target.value)}><option value="">Tất cả</option><option value="frontend">Frontend</option><option value="backend">Backend</option></select></label>
          <label className="el-noise-toggle"><input type="checkbox" checked={hideNoise} onChange={(event) => setHideNoise(event.target.checked)} /><span>Ẩn nhiễu (bên thứ 3 / thử nghiệm)</span></label>
        </div>

        {logsError && <div className="el-inline-error" role="alert">Không tải được báo lỗi: {logsError}</div>}
        {logsLoading ? <div className="el-state" role="status">Đang tải báo lỗi…</div>
          : visibleRows.length === 0 ? <div className="el-state">{rows.length && hideNoise ? 'Trang này chỉ có mục nhiễu đang được ẩn.' : 'Chưa có lỗi nào — đây là tin tốt 🎉'}</div>
            : (
              <div className="el-table-scroll el-log-table-wrap">
                <table className="el-log-table">
                  <thead><tr><th>Thời gian</th><th>Mức độ</th><th>Nguồn</th><th>Thông báo</th><th>URL</th><th>User</th><th>Trạng thái</th><th><span className="sr-only">Thao tác</span></th></tr></thead>
                  <tbody>{visibleRows.map((row) => {
                    const summary = humanizeError(row);
                    const isExpanded = expanded.has(row.id);
                    return (
                      <Fragment key={row.id}>
                      <tr className={row.dismissed_at ? 'is-dismissed' : ''}>
                        <td className="el-time"><code>{formatLogTime(row.occurred_at)}</code></td>
                        <td><span className={`el-chip is-${row.level}`}>{row.level}</span></td>
                        <td><span className="el-chip">{row.source}</span></td>
                        <td className="el-message"><CategoryChip category={summary.category} tone={summary.tone} /> <span title={truncate(row.message, 200)}>{summary.summary}</span></td>
                        <td className="el-url" title={row.url || undefined}>{truncate(row.url, 40)}</td>
                        <td>{row.user_id ? <code>{row.user_id.slice(0, 8)}…</code> : <span className="el-muted">anon</span>}</td>
                        <td><StatusChip dismissed={Boolean(row.dismissed_at)} /></td>
                        <td><button className="btn-secondary el-view-button" type="button" aria-expanded={isExpanded} aria-controls={`detail-${row.id}`} onClick={() => setExpanded((current) => { const next = new Set(current); if (next.has(row.id)) next.delete(row.id); else next.add(row.id); return next; })}>{isExpanded ? 'Ẩn' : 'Xem'}</button></td>
                      </tr>
                      {isExpanded && <tr className="el-detail-row"><td className="el-detail-cell" id={`detail-${row.id}`} colSpan={8}><ErrorDetail row={row} pending={pendingRows.has(row.id)} onDismiss={(id) => void runRowMutation(id, 'dismiss')} onUndismiss={(id) => void runRowMutation(id, 'undismiss')} /></td></tr>}
                      </Fragment>
                    );
                  })}</tbody>
                </table>
              </div>
            )}
        <div className="el-pagination" aria-label="Phân trang báo lỗi">
          <span>{rows.length ? `Dòng ${offset + 1}–${offset + rows.length}` : 'Không có dòng'}</span>
          <div><button className="btn-secondary" type="button" disabled={logsLoading || offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Trang trước</button><button className="btn-secondary" type="button" disabled={logsLoading || rows.length < PAGE_SIZE} onClick={() => setOffset(offset + PAGE_SIZE)}>Trang sau</button></div>
        </div>
      </section>
    </main>
  );
}
