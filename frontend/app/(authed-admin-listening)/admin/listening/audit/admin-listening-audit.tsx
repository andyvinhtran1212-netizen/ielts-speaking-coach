'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { useAdminProfile } from '@/components/admin-access-gate';
import {
  LISTENING_AUDIT_HEALTH_LABEL,
  LISTENING_AUDIT_SAVED_LABEL,
  LISTENING_AUDIT_TYPE_LABEL,
  classifyListeningAudit,
  filterListeningAuditRows,
  formatListeningAuditDate,
  listeningAuditDetailHref,
  listeningAuditHref,
  normalizeListeningAuditFilters,
  normalizeListeningAuditInventoryPage,
  normalizeListeningAuditSnapshot,
  summarizeListeningAuditRows,
} from '@/lib/admin-listening-audit-model.mjs';

type TestType = 'all' | 'full' | 'mini' | 'drill' | 'practice';
type HealthFilter = 'all' | 'error' | 'warning' | 'clean' | 'lookup';
type SavedStatus = 'all' | 'pending' | 'passed' | 'has_issues' | 'fixed';
type Filters = { search: string; type: TestType; health: HealthFilter; saved: SavedStatus };
type TestRow = { id: string; testId: string; title: string; status: 'draft' | 'published' | 'archived'; type: Exclude<TestType, 'all'>; sectionCount: number; audioReadyCount: number; examOnly: boolean; updatedAt: string | null; createdAt: string | null };
type AuditValue = { id: string; testId: string; title: string; status: TestRow['status']; type: TestRow['type']; questionCount: number; sectionCount: number; live: { errorCount: number; warningCount: number; status: 'passed' | 'has_issues'; issueCount: number }; saved: { status: Exclude<SavedStatus, 'all'>; health: { errorCount: number; warningCount: number; status: string } | null; auditedAt: string | null; updatedAt: string | null } };
type AuditState = { phase: 'loading' } | { phase: 'ready'; value: AuditValue } | { phase: 'error'; message: string };
type CombinedRow = { test: TestRow; audit: AuditState };

const PAGE_LIMIT = 100;
const MAX_TOTAL = 10_000;
const AUDIT_BATCH = 8;
const messageOf = (caught: unknown) => caught instanceof Error ? caught.message : String(caught || 'Lỗi không xác định');
const TYPE_OPTIONS = Object.entries(LISTENING_AUDIT_TYPE_LABEL) as Array<[TestType, string]>;
const HEALTH_OPTIONS = Object.entries(LISTENING_AUDIT_HEALTH_LABEL) as Array<[HealthFilter, string]>;
const SAVED_OPTIONS = Object.entries(LISTENING_AUDIT_SAVED_LABEL) as Array<[SavedStatus, string]>;
const testStatusLabel = { draft: 'Draft', published: 'Published', archived: 'Archived' };
const testStatusClass = (status: TestRow['status']) => status === 'published' ? 'is-live' : status === 'archived' ? 'is-failed' : 'is-muted';
const savedStatusClass = (status: Exclude<SavedStatus, 'all'>) => status === 'passed' || status === 'fixed' ? 'is-live' : status === 'has_issues' ? 'is-failed' : 'is-muted';

export function AdminListeningAudit() {
  const profile = useAdminProfile();
  const router = useRouter();
  const params = useSearchParams();
  const filters = normalizeListeningAuditFilters({ search: params?.get('search'), type: params?.get('type'), health: params?.get('health'), saved: params?.get('saved') }) as Filters;
  const [draft, setDraft] = useState(filters);
  const [tests, setTests] = useState<TestRow[]>([]);
  const [auditById, setAuditById] = useState<Record<string, AuditState>>({});
  const [inventoryAt, setInventoryAt] = useState<string | null>(null);
  const [inventoryLoading, setInventoryLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [inventoryError, setInventoryError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [progress, setProgress] = useState({ complete: 0, total: 0 });
  const activeAccount = useRef(profile.id);
  const inventorySequence = useRef(0);
  const scanSequence = useRef(0);
  const inventoryLock = useRef(false);
  const scanLock = useRef(false);
  activeAccount.current = profile.id;

  useEffect(() => setDraft(filters), [filters.search, filters.type, filters.health, filters.saved]);

  const scan = useCallback(async (targets: TestRow[], owner: string) => {
    if (scanLock.current || !targets.length) return;
    const request = ++scanSequence.current;
    scanLock.current = true;
    setScanning(true); setNotice(null); setProgress({ complete: 0, total: targets.length });
    setAuditById((current) => {
      const next = { ...current };
      for (const test of targets) next[test.id] = { phase: 'loading' };
      return next;
    });
    let complete = 0;
    try {
      for (let offset = 0; offset < targets.length; offset += AUDIT_BATCH) {
        const batch = targets.slice(offset, offset + AUDIT_BATCH);
        const results = await Promise.all(batch.map(async (test) => {
          try {
            const raw = await window.api.get<unknown>(`/admin/listening/tests/${encodeURIComponent(test.id)}/audit`);
            const value = normalizeListeningAuditSnapshot(raw, { id: test.id, testId: test.testId }) as AuditValue | null;
            if (!value || value.type !== test.type || value.status !== test.status) throw new Error('Audit GET không khớp identity, loại, status hoặc health contract.');
            return [test.id, { phase: 'ready', value } as AuditState] as const;
          } catch (caught) {
            return [test.id, { phase: 'error', message: messageOf(caught) } as AuditState] as const;
          }
        }));
        if (request !== scanSequence.current || activeAccount.current !== owner) return;
        setAuditById((current) => {
          const next = { ...current };
          for (const [id, state] of results) next[id] = state;
          return next;
        });
        complete += results.length;
        setProgress({ complete, total: targets.length });
      }
      if (request === scanSequence.current && activeAccount.current === owner) setNotice(`Đã đọc live structural health cho ${targets.length} test.`);
    } finally {
      if (request === scanSequence.current && activeAccount.current === owner) {
        scanLock.current = false; setScanning(false);
      }
    }
  }, []);

  const load = useCallback(async (preserve = true) => {
    if (inventoryLock.current) return;
    const owner = profile.id;
    const request = ++inventorySequence.current;
    inventoryLock.current = true;
    scanSequence.current += 1; scanLock.current = false;
    setInventoryLoading(true); setScanning(false); setInventoryError(null); setNotice(null);
    try {
      const rows: TestRow[] = [];
      const ids = new Set<string>();
      let expectedTotal: number | null = null;
      for (let offset = 0; ; offset += PAGE_LIMIT) {
        const query = new URLSearchParams({ status: 'all', test_type: 'all', search: '', limit: String(PAGE_LIMIT), offset: String(offset) });
        const page = normalizeListeningAuditInventoryPage(await window.api.get<unknown>(`/admin/listening/tests?${query}`), { limit: PAGE_LIMIT, offset }) as { rows: TestRow[]; total: number } | null;
        if (!page) throw new Error('Inventory page sai contract hoặc có dòng không thể kiểm chứng.');
        if (expectedTotal == null) expectedTotal = page.total;
        else if (page.total !== expectedTotal) throw new Error('Tổng test thay đổi trong lúc phân trang; chưa công bố snapshot partial.');
        if (page.total > MAX_TOTAL) throw new Error(`Inventory vượt guard ${MAX_TOTAL} test; cần endpoint bulk trước khi audit.`);
        for (const row of page.rows) {
          if (ids.has(row.id)) throw new Error(`Test UUID ${row.id} lặp giữa các page.`);
          ids.add(row.id); rows.push(row);
        }
        if (rows.length >= page.total) break;
        if (!page.rows.length || page.rows.length < PAGE_LIMIT) throw new Error('Inventory kết thúc sớm trước canonical total; chưa công bố snapshot partial.');
      }
      if (expectedTotal == null || rows.length !== expectedTotal) throw new Error('Số test đã đọc không khớp canonical total.');
      if (request !== inventorySequence.current || activeAccount.current !== owner) return;
      const initial = Object.fromEntries(rows.map((row) => [row.id, { phase: 'loading' } as AuditState]));
      setTests(rows); setAuditById(initial); setInventoryAt(new Date().toISOString());
      await scan(rows, owner);
    } catch (caught) {
      if (request === inventorySequence.current && activeAccount.current === owner) {
        setInventoryError(`${preserve && tests.length ? 'Không thể làm mới — đang giữ snapshot trước. ' : ''}${messageOf(caught)}`);
      }
    } finally {
      if (request === inventorySequence.current && activeAccount.current === owner) {
        inventoryLock.current = false; setInventoryLoading(false);
      }
    }
  }, [profile.id, scan, tests.length]);

  useEffect(() => {
    const owner = profile.id;
    activeAccount.current = owner;
    inventorySequence.current += 1; scanSequence.current += 1; inventoryLock.current = false; scanLock.current = false;
    setTests([]); setAuditById({}); setInventoryAt(null); setInventoryError(null); setNotice(null); setProgress({ complete: 0, total: 0 });
    void load(false);
    return () => { inventorySequence.current += 1; scanSequence.current += 1; inventoryLock.current = false; scanLock.current = false; };
  }, [profile.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const combined: CombinedRow[] = tests.map((test) => ({ test, audit: auditById[test.id] || { phase: 'loading' } }));
  const visible = filterListeningAuditRows(combined, filters) as CombinedRow[];
  const summary = summarizeListeningAuditRows(combined) as { total: number; loading: number; lookup: number; error: number; warning: number; clean: number; savedPending: number };
  const activeFilterCount = [filters.search, filters.type !== 'all', filters.health !== 'all', filters.saved !== 'all'].filter(Boolean).length;
  const failedTests = combined.filter((row) => row.audit.phase === 'error').map((row) => row.test);

  const applyFilters = (event: FormEvent) => { event.preventDefault(); router.push(listeningAuditHref(draft)); };
  const retryFailed = () => void scan(failedTests, profile.id);
  const retryOne = (test: TestRow) => void scan([test], profile.id);
  const progressPercent = progress.total ? Math.round(progress.complete / progress.total * 100) : 0;

  return <main className="alqa-shell">
    <header className="alqa-hero">
      <div><p className="alc-eyebrow">Listening · Quality operations</p><h1>Audit chất lượng toàn bộ kho test</h1><p>Đọc nhanh cấu trúc và audio hiện tại cho từng test, đồng thời giữ riêng kết quả full audit đã lưu. Lookup failure không bao giờ bị diễn giải thành “sạch”.</p></div>
      <div className="alqa-hero__actions"><a className="adm-btn-secondary" href="/admin/listening/tests">Kho test</a><a className="adm-btn-secondary" href="/pages/admin/listening/audit.html">HTML rollback ↗</a></div>
    </header>

    <section className="alqa-boundary" aria-labelledby="alqa-boundary-title">
      <div><p className="alc-eyebrow">Evidence boundary</p><h2 id="alqa-boundary-title">Hai kết quả, hai thời điểm khác nhau</h2></div>
      <div><span>Live structural</span><strong>GET vừa đọc</strong><small>Cấu trúc + audio bounds, không gọi LLM</small></div>
      <div><span>Saved full audit</span><strong>Snapshot đã lưu</strong><small>Structural + LLM từ lần chạy gần nhất</small></div>
    </section>

    <section className="alqa-summary" aria-label="Tổng quan audit">
      <div><span>Inventory canonical</span><strong>{summary.total}</strong><small>{inventoryAt ? `Đọc ${formatListeningAuditDate(inventoryAt)}` : 'Đang đọc…'}</small></div>
      <div className={summary.error ? 'is-error' : ''}><span>Test có lỗi live</span><strong>{summary.error}</strong><small>Phải xử lý trước publish</small></div>
      <div className={summary.warning ? 'is-warning' : ''}><span>Test có cảnh báo</span><strong>{summary.warning}</strong><small>Không có error live</small></div>
      <div className={summary.lookup ? 'is-lookup' : ''}><span>Lookup failed</span><strong>{summary.lookup}</strong><small>Không kết luận health</small></div>
    </section>

    <section className="alqa-library" aria-labelledby="alqa-list-title" aria-busy={inventoryLoading || scanning}>
      <div className="alqa-section-head"><div><p>Canonical coverage</p><h2 id="alqa-list-title">Test health inventory</h2><span>{tests.length ? `${visible.length}/${summary.total} test · ${activeFilterCount} bộ lọc · ${summary.savedPending} chưa full audit` : 'Đang đọc từ backend…'}</span></div><div><button className="adm-btn-secondary" type="button" disabled={inventoryLoading || scanning} onClick={() => void load()}>{inventoryLoading ? 'Đang tải…' : 'Làm mới toàn bộ'}</button>{failedTests.length > 0 && <button className="adm-btn-secondary" type="button" disabled={inventoryLoading || scanning} onClick={retryFailed}>Retry {failedTests.length} lookup failed</button>}</div></div>

      <form className="alqa-filters" onSubmit={applyFilters}>
        <label><span>Test</span><input type="search" value={draft.search} placeholder="Test ID hoặc tiêu đề" onChange={(event) => setDraft((value) => ({ ...value, search: event.target.value }))} /></label>
        <label><span>Loại</span><select value={draft.type} onChange={(event) => setDraft((value) => ({ ...value, type: event.target.value as TestType }))}>{TYPE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label><span>Live health</span><select value={draft.health} onChange={(event) => setDraft((value) => ({ ...value, health: event.target.value as HealthFilter }))}>{HEALTH_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label><span>Full audit đã lưu</span><select value={draft.saved} onChange={(event) => setDraft((value) => ({ ...value, saved: event.target.value as SavedStatus }))}>{SAVED_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <div className="alqa-filter-actions"><button className="adm-btn-primary" type="submit">Áp dụng</button>{activeFilterCount > 0 && <button className="adm-btn-secondary" type="button" onClick={() => router.push('/admin/listening/audit')}>Xóa lọc</button>}</div>
      </form>

      {inventoryError && <div className="alc-banner is-error" role="alert"><strong>Inventory chưa khép kín</strong><span>{inventoryError}</span></div>}
      {summary.lookup > 0 && <div className="alc-banner is-warning" role="alert"><strong>{summary.lookup} test không đọc được audit</strong><span>Các hàng này được đánh dấu Lookup failed và không tính là sạch. Retry chỉ phát GET, không tạo hoặc sửa dữ liệu.</span></div>}
      {notice && !scanning && <div className="alc-banner is-success" role="status"><strong>Live scan hoàn tất</strong><span>{notice}</span></div>}
      {scanning && <div className="alqa-progress"><div><strong>Đang đọc live health</strong><span aria-hidden="true">{progress.complete}/{progress.total} test</span></div><div role="progressbar" aria-label="Tiến độ đọc audit" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent} aria-valuetext={`${progress.complete} trên ${progress.total} test`}><span style={{ width: `${progressPercent}%` }} /></div></div>}
      {inventoryLoading && !tests.length && <div className="alqa-state" role="status">Đang phân trang toàn bộ kho test…</div>}
      {!inventoryLoading && !inventoryError && !tests.length && <div className="alqa-state"><strong>Kho test đang trống</strong><span>Import một test trước khi chạy quality audit.</span></div>}
      {tests.length > 0 && !visible.length && <div className="alqa-state"><strong>Không có test khớp bộ lọc</strong><span>Xóa bớt filter hoặc tìm theo Test ID khác.</span></div>}
      {visible.length > 0 && <div className="alqa-table-wrap" role="region" aria-label="Bảng quality audit Listening" tabIndex={0}><table className="alqa-table"><thead><tr><th>Test</th><th>Cấu trúc</th><th>Live structural</th><th>Saved full audit</th><th>Thao tác</th></tr></thead><tbody>{visible.map((row) => <AuditRow key={row.test.id} row={row} busy={inventoryLoading || scanning} onRetry={retryOne} />)}</tbody></table></div>}
    </section>
  </main>;
}

function AuditRow({ row, busy, onRetry }: { row: CombinedRow; busy: boolean; onRetry: (test: TestRow) => void }) {
  const { test, audit } = row;
  const health = classifyListeningAudit(audit) as 'loading' | 'lookup' | 'error' | 'warning' | 'clean';
  const healthLabel = health === 'loading' ? 'Đang đọc' : health === 'lookup' ? 'Lookup failed' : health === 'error' ? `${audit.phase === 'ready' ? audit.value.live.errorCount : 0} lỗi` : health === 'warning' ? `${audit.phase === 'ready' ? audit.value.live.warningCount : 0} cảnh báo` : 'Sạch';
  const healthClass = health === 'clean' ? 'is-live' : health === 'error' || health === 'lookup' ? 'is-failed' : health === 'warning' ? 'is-warning' : 'is-muted';
  const saved = audit.phase === 'ready' ? audit.value.saved : null;
  return <tr data-test-id={test.id}>
    <td data-label="Test"><a className="alqa-test" href={`/admin/listening/tests/${encodeURIComponent(test.id)}`}>{test.testId}</a><strong>{test.title}</strong><small><span className={`adm-status-pill ${testStatusClass(test.status)}`}>{testStatusLabel[test.status]}</span> · {LISTENING_AUDIT_TYPE_LABEL[test.type]}</small></td>
    <td data-label="Cấu trúc"><strong>{audit.phase === 'ready' ? `${audit.value.questionCount} câu` : `${test.sectionCount} section`}</strong><small>{audit.phase === 'ready' ? `${audit.value.sectionCount} section canonical` : `${test.audioReadyCount}/${test.sectionCount} section có audio`}</small></td>
    <td data-label="Live structural"><span className={`adm-status-pill ${healthClass}`}>{healthLabel}</span>{audit.phase === 'ready' && <small>{audit.value.live.errorCount} error · {audit.value.live.warningCount} warning</small>}{audit.phase === 'error' && <small>{audit.message}</small>}</td>
    <td data-label="Saved full audit">{saved ? <><span className={`adm-status-pill ${savedStatusClass(saved.status)}`}>{LISTENING_AUDIT_SAVED_LABEL[saved.status]}</span><small>{saved.auditedAt ? `Chạy ${formatListeningAuditDate(saved.auditedAt)}` : saved.status === 'pending' ? 'Chưa có full run đã lưu' : 'Đã chạy · không rõ thời điểm'}</small></> : <><span className="adm-status-pill is-muted">Chưa xác định</span><small>Chờ live GET</small></>}</td>
    <td data-label="Thao tác"><div className="alqa-actions"><a href={listeningAuditDetailHref(test.id)}>Mở audit detail ↗</a><a href={`/admin/listening/tests/${encodeURIComponent(test.id)}`}>Mở test</a><button type="button" disabled={busy} onClick={() => onRetry(test)}>Đọc lại GET</button></div></td>
  </tr>;
}
