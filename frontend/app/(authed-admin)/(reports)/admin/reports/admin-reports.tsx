'use client';

// Báo cáo: one page, four tabs (ADMINIA-0074 FR-164; sheet AdminBaoCao; G09-T41).
// Tab and range live in the URL (`?tab=&range=`), so a reload keeps both. Each
// tab reads one existing API; a failed or foreign answer breaks only that tab.
// Numbers the APIs cannot give say "chưa có" with the reason, never 0.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { getBrowserJson } from '@/lib/browser-api';
import { REVIEW_QUEUE_HREF } from '@/lib/admin-incidents-model.mjs';
import {
  REPORT_RANGES,
  REPORT_TABS,
  activityReport,
  aiCostReport,
  csvFileName,
  footTrafficQuery,
  formatCell,
  liveAdminHref,
  parseReportsQuery,
  rangeText,
  reportCsv,
  reportsHref,
  tabLabel,
  trafficReport,
  type ReportTable,
  type ReportTile,
} from '@/lib/admin-reports-model.mjs';

type Table = ReportTable;
type Tile = ReportTile;
type Missing = { id: string; title: string; reason: string };
type Report = { tiles: Tile[]; tables: Table[]; missing: Missing[]; warning?: string | null; links: { label: string; href: string }[] };
type Load = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; report: Report };

const SOURCE_NAME: Partial<Record<string, string>> = {
  'hoat-dong': 'hoạt động học viên',
  'luu-luong': 'lưu lượng',
  'chi-phi-ai': 'chi phí AI',
};

function links(items: [string, string][]) {
  return items.flatMap(([label, href]) => {
    const live = liveAdminHref(href);
    return live ? [{ label, href: live }] : [];
  });
}

/** Reads the open tab's source and turns it into tiles, tables and gaps. */
async function loadReport(tab: string, range: number, signal: AbortSignal): Promise<Report | null> {
  if (tab === 'hoat-dong') {
    const out = activityReport(await getBrowserJson('/admin/overview', undefined, signal), range);
    if (!out) return null;
    return {
      tiles: out.tiles,
      tables: out.tables,
      missing: [
        { id: 'weekly', title: 'Hình 1 · Người hoạt động theo tuần', reason: 'chưa có nguồn số liệu theo tuần.' },
        ...(out.tables.some((t: Table) => t.id === 'cohorts') ? [] : [{ id: 'cohorts', title: 'Bảng 2 · Học viên theo lớp', reason: `${out.cohortsReason}.` }]),
        { id: 'attention', title: 'Nộp đúng hạn, trung vị điểm và cần chú ý theo lớp, khoá', reason: 'cần ngưỡng vận hành và dữ liệu khoá học, chưa có trên hệ thống.' },
      ],
      links: links([
        ['Bài Reading', '/admin/dashboard/reading-attempts'],
        ['Phiên Speaking', '/admin/speaking/sessions'],
        ['Bài Listening', '/admin/listening/attempts'],
      ]),
    };
  }
  if (tab === 'luu-luong') {
    const out = trafficReport(await getBrowserJson('/admin/analytics/foot-traffic', new URLSearchParams(footTrafficQuery(range)), signal), range);
    if (!out) return null;
    const unavailable = out.status === 'unavailable';
    return {
      tiles: out.tiles,
      tables: out.tables,
      warning: unavailable
        ? 'Bộ đếm lượt xem không đọc được trong khoảng này. Không có số nào được hiện thay.'
        : out.partial ? 'Thiếu một phần dữ liệu: số có dấu ≥ là tối thiểu, ngày không có dữ liệu để trống, không tính bằng 0.' : null,
      missing: [
        { id: 'referrers', title: 'Hình 4 · Nguồn truy cập', reason: 'bộ đếm chưa lưu trang giới thiệu.' },
        { id: 'funnel', title: 'Từ trang khoá tới mở khoá', reason: 'cần đơn đăng ký khoá online, chưa có trên hệ thống.' },
      ],
      links: links([['Lưu lượng theo trang', '/admin/foot-traffic']]),
    };
  }
  if (tab === 'chi-phi-ai') {
    const out = aiCostReport(await getBrowserJson('/admin/ai-usage', new URLSearchParams({ days: String(range) }), signal));
    if (!out) return null;
    return {
      tiles: out.tiles,
      tables: out.tables,
      warning: out.truncated ? 'Nhật ký lượt gọi đã chạm giới hạn đọc: chi phí và lượt gọi là số tối thiểu (≥).' : null,
      missing: [
        { id: 'budget', title: 'Ngân sách AI tháng này', reason: 'ngân sách và ngưỡng chưa được khai ở Hệ thống › AI và mô hình.' },
        { id: 'per-day', title: 'Hình 6 · Chi phí AI theo ngày', reason: 'nguồn chưa chia theo ngày.' },
        { id: 'per-item', title: 'Chi phí trên một bài chấm', reason: 'nguồn chưa gom lượt gọi theo bài.' },
      ],
      links: links([
        ['Chi phí theo người', '/admin/usage'],
        ['Nhật ký lượt gọi AI', '/admin/system/ai-usage'],
      ]),
    };
  }
  return {
    tiles: [
      { id: 'queue', label: 'Câu đang chờ kiểm', value: null, kind: 'count', reason: 'hàng chờ Câu cần kiểm chưa có' },
      { id: 'reports', label: 'Học viên báo lỗi đáp án', value: null, kind: 'count', reason: 'hàng chờ Câu cần kiểm chưa có' },
      { id: 'error-rate', label: 'Tỉ lệ sai bất thường', value: null, kind: 'count', reason: 'hàng chờ Câu cần kiểm chưa có' },
    ],
    tables: [],
    missing: [],
    links: links([['Phản hồi của học viên', REVIEW_QUEUE_HREF]]),
  };
}

export function AdminReports() {
  const router = useRouter();
  const search = useSearchParams();
  const query = search?.toString() ?? '';
  const state = useMemo(() => parseReportsQuery(query), [query]);
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [exported, setExported] = useState<string | null>(null);

  useEffect(() => {
    // Only the newest read fills the page: an older answer for another tab or
    // range is dropped.
    const controller = new AbortController();
    setLoad({ kind: 'loading' });
    setExported(null);
    (async () => {
      try {
        const report = await loadReport(state.tab, state.range, controller.signal);
        if (controller.signal.aborted) return;
        setLoad(report ? { kind: 'ready', report } : { kind: 'error' });
        if (!report) console.warn('[admin-reports] foreign shape', state.tab);
      } catch (caught) {
        if (controller.signal.aborted) return;
        console.warn('[admin-reports] load failed', state.tab, caught);
        setLoad({ kind: 'error' });
      }
    })();
    return () => controller.abort();
  }, [state.tab, state.range, attempt]);

  const go = useCallback((next: Partial<typeof state>) => {
    router.push(reportsHref({ ...state, ...next }));
  }, [router, state]);

  const tables = load.kind === 'ready' ? load.report.tables : [];
  const exportCsv = () => {
    if (!tables.length) return;
    const blob = new Blob([`﻿${reportCsv(tables)}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = csvFileName(state.tab, state.range);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setExported(`Đã tạo file CSV của thẻ ${tabLabel(state.tab)} cho ${state.range} ngày gần nhất: mỗi bảng số liệu là một phần trong file.`);
  };

  return (
    <main className="rep-shell">
      <header className="rep-header">
        <div>
          <h1>Báo cáo</h1>
          <p className="subtitle">{rangeText(state.range)} · giờ Việt Nam</p>
        </div>
        <div className="rep-tools">
          <div className="rep-ranges" role="group" aria-label="Khoảng thời gian">
            {REPORT_RANGES.map((range) => (
              <button key={range} type="button" aria-pressed={state.range === range} onClick={() => go({ range })}>
                {range} ngày
              </button>
            ))}
          </div>
          <button type="button" className="rep-export" disabled={!tables.length} onClick={exportCsv}>Xuất CSV</button>
        </div>
      </header>
      {exported ? <p className="rep-banner" role="status">{exported}</p> : null}

      <nav className="rep-tabs" aria-label="Thẻ báo cáo">
        {REPORT_TABS.map((t) => (
          <a key={t.id} href={reportsHref({ ...state, tab: t.id })}
            aria-current={state.tab === t.id ? 'page' : undefined}
            onClick={(e) => { e.preventDefault(); go({ tab: t.id }); }}>
            {t.label}
          </a>
        ))}
      </nav>

      <section aria-label={tabLabel(state.tab)} className="rep-body">
        {load.kind === 'loading' ? <p className="rep-muted" role="status">Đang tải số liệu…</p> : null}
        {load.kind === 'error' ? (
          <div className="rep-error" role="alert">
            <h2>Chưa tải được {SOURCE_NAME[state.tab] ?? 'báo cáo'}</h2>
            <p>Không hiện số cũ như số mới. Các thẻ còn lại vẫn xem được.</p>
            <div className="rep-actions">
              <button type="button" onClick={() => setAttempt((n) => n + 1)}>Tải lại</button>
              {liveAdminHref('/admin/incidents') ? <a href="/admin/incidents?source=errors">Xem trong Hộp thư sự cố</a> : null}
            </div>
          </div>
        ) : null}
        {load.kind === 'ready' ? <ReportView report={load.report} /> : null}
      </section>
    </main>
  );
}

function ReportView({ report }: { report: Report }) {
  return (
    <>
      {report.warning ? <p className="rep-warning" role="note">{report.warning}</p> : null}
      {report.tiles.length ? (
        <div className="rep-tiles">
          {report.tiles.map((tile) => <TileView key={tile.id} tile={tile} />)}
        </div>
      ) : null}
      {report.tables.map((table) => <TableView key={table.id} table={table} />)}
      {report.missing.map((m) => (
        <section key={m.id} className="rep-missing" aria-label={m.title}>
          <h2>{m.title}</h2>
          <p><strong>chưa có</strong> · {m.reason}</p>
        </section>
      ))}
      {report.links.length ? (
        <p className="rep-links">
          Xem chi tiết:{' '}
          {report.links.map((l, i) => (
            <span key={l.href}>{i ? ' · ' : null}<a href={l.href}>{l.label}</a></span>
          ))}
        </p>
      ) : null}
    </>
  );
}

function TileView({ tile }: { tile: Tile }) {
  const missing = tile.value == null;
  let note: ReactNode = tile.note ?? null;
  if (missing) note = tile.reason ?? 'nguồn không trả số này';
  return (
    <div className="rep-tile">
      <p className="rep-tile-label">{tile.label}</p>
      <p className={missing ? 'rep-tile-value is-missing' : 'rep-tile-value'}>
        {missing ? 'chưa có' : `${tile.atLeast ? '≥ ' : ''}${formatCell(tile.value, tile.kind)}`}
      </p>
      {note ? <p className="rep-tile-note">{note}</p> : null}
    </div>
  );
}

function TableView({ table }: { table: Table }) {
  return (
    <figure className="rep-figure" aria-labelledby={`rep-${table.id}`}>
      <figcaption>
        <h2 id={`rep-${table.id}`}>{table.title}</h2>
        <p>{table.caption}</p>
      </figcaption>
      <div className="rep-table-wrap">
        <table className="rep-table">
          <thead>
            <tr>{table.columns.map((c) => <th key={c.label} scope="col">{c.label}</th>)}</tr>
          </thead>
          <tbody>
            {table.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, i) => {
                  const kind = table.columns[i].kind;
                  if (i === 0) return <th key={i} scope="row">{String(cell ?? '')}</th>;
                  const gap = cell == null;
                  return <td key={i} className={gap ? 'is-missing' : undefined}>{gap ? 'không có dữ liệu' : formatCell(cell, kind)}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="rep-source">{table.source}</p>
    </figure>
  );
}
