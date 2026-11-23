'use client';

// Hộp thư sự cố (ADMINIA-0074 FR-070…FR-073; plan 5.4; G09-T16).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import {
  fetchIncidentGroups,
  postIncidentBulk,
  type IncidentAction,
  type IncidentGroup,
  type IncidentGroupsPage,
} from '@/lib/admin-incidents-api';
import {
  ACTION_LABEL,
  REVIEW_QUEUE_HREF,
  SORTS,
  SORT_LABEL,
  SOURCES,
  SOURCE_LABEL,
  STATUSES,
  STATUS_FILTER_LABEL,
  STATUS_LABEL,
  bulkRefs,
  bulkResultText,
  confirmText,
  formatCount,
  formatWhen,
  groupHref,
  groupsApiQuery,
  inboxQueryString,
  parseInboxQuery,
  undoActionFor,
} from '@/lib/admin-incidents-model.mjs';

type InboxState = ReturnType<typeof parseInboxQuery>;
type Pending = { action: IncidentAction; groups: IncidentGroup[] } | null;
type Banner = { kind: 'success' | 'error'; text: string; undo?: { action: IncidentAction; groups: IncidentGroup[] } } | null;

const BULK_ACTIONS: IncidentAction[] = ['claim', 'resolve', 'ignore', 'reopen'];
const keyOf = (g: IncidentGroup) => `${g.source}:${g.fingerprint}`;

function messageOf(caught: unknown) {
  return caught instanceof Error ? caught.message : 'lỗi không xác định';
}

export function AdminIncidents() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  // Keyed on the string: the params object is not stable across renders.
  const query = search?.toString() ?? '';
  const state = useMemo(() => parseInboxQuery(query), [query]);
  const [data, setData] = useState<IncidentGroupsPage | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);

  // Only the newest request may fill the page: an older answer for another
  // filter (or a reload started before the filter changed) is dropped, and the
  // rows are cleared while a new query loads so stale rows are never actionable.
  const sequence = useRef(0);
  const current = useRef(state);
  current.current = state;

  const load = useCallback(async (s: InboxState) => {
    const id = ++sequence.current;
    setLoadError(null);
    try {
      const out = await fetchIncidentGroups(groupsApiQuery(s));
      if (id === sequence.current) setData(out);
    } catch (caught) {
      if (id !== sequence.current) return;
      console.warn('[admin-incidents] load failed', caught);
      setData(null);
      setLoadError(messageOf(caught));
    }
  }, []);

  useEffect(() => { setSelected(new Set()); setData(null); void load(state); }, [load, state]);

  const go = (next: Partial<InboxState>) => {
    router.push(`${pathname}${inboxQueryString({ ...state, page: 1, ...next })}`);
  };

  const items = data?.items ?? [];
  const chosen = items.filter((g) => selected.has(keyOf(g)));
  const allChecked = items.length > 0 && chosen.length === items.length;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;

  const run = async (action: IncidentAction, groups: IncidentGroup[], fromUndo = false) => {
    setBusy(true);
    try {
      const out = await postIncidentBulk(action, bulkRefs(groups));
      const failed = new Set(out.conflicts.map((c) => `${c.source}:${c.fingerprint}`));
      const changed = groups.filter((g) => !failed.has(keyOf(g)));
      const undo = undoActionFor(action);
      setBanner({
        kind: out.conflicts.length && !out.changed ? 'error' : 'success',
        text: bulkResultText(action, out),
        ...(undo && !fromUndo && out.changed ? { undo: { action: undo, groups: changed } } : {}),
      });
      setSelected(new Set());
      await load(current.current);
    } catch (caught) {
      setBanner({ kind: 'error', text: `Chưa thực hiện được: ${messageOf(caught)}` });
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  const toggle = (g: IncidentGroup) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(keyOf(g))) next.delete(keyOf(g)); else next.add(keyOf(g));
    return next;
  });

  return (
    <main className="inc-shell">
      <header className="inc-header">
        <h1>Hộp thư sự cố</h1>
        <p className="subtitle">Lỗi hệ thống, bài chấm bị dừng và phản hồi của học viên, gộp theo nhóm cùng nguyên nhân.</p>
      </header>

      <nav className="inc-tabs" aria-label="Nguồn sự cố">
        <a href={`${pathname}${inboxQueryString({ ...state, source: null, page: 1 })}`}
          aria-current={state.source === null ? 'page' : undefined}
          onClick={(e) => { e.preventDefault(); go({ source: null }); }}>Tất cả</a>
        {SOURCES.map((source) => {
          const count = data?.counts?.[source as keyof IncidentGroupsPage['counts']];
          return (
            <a key={source} href={`${pathname}${inboxQueryString({ ...state, source, page: 1 })}`}
              aria-current={state.source === source ? 'page' : undefined}
              onClick={(e) => { e.preventDefault(); go({ source }); }}>
              {SOURCE_LABEL[source as keyof typeof SOURCE_LABEL]}
              {Number.isInteger(count) ? <span className="inc-count">{formatCount(count)}</span> : null}
            </a>
          );
        })}
      </nav>

      {data && Number.isInteger(data.review_items_open) && (data.review_items_open as number) > 0 ? (
        <p className="inc-review-line">
          <a href={REVIEW_QUEUE_HREF}>{formatCount(data.review_items_open)} câu đang chờ ở Câu cần kiểm</a>
        </p>
      ) : null}

      <div className="inc-filters">
        <label>Trạng thái{' '}
          <select value={state.status} onChange={(e) => go({ status: e.target.value })}>
            {STATUSES.map((s) => <option key={s} value={s}>{STATUS_FILTER_LABEL[s as keyof typeof STATUS_FILTER_LABEL]}</option>)}
          </select>
        </label>
        <label>Sắp xếp{' '}
          <select value={state.sort} onChange={(e) => go({ sort: e.target.value })}>
            {SORTS.map((s) => <option key={s} value={s}>{SORT_LABEL[s as keyof typeof SORT_LABEL]}</option>)}
          </select>
        </label>
      </div>

      {data?.sources_failed?.length ? (
        <p className="inc-warning" role="status">
          Chưa tải được: {data.sources_failed.map((s) => SOURCE_LABEL[s]).join(', ')}. Các nhóm của nguồn này không có trong danh sách.
        </p>
      ) : null}
      {data?.truncated ? (
        <p className="inc-note" role="status">Nguồn có quá nhiều bản ghi: chỉ 5.000 dòng mới nhất được gộp nhóm.</p>
      ) : null}

      {banner ? (
        <div className={`inc-banner is-${banner.kind}`} role="status">
          <span>{banner.text}</span>
          {banner.undo ? (
            <button type="button" disabled={busy}
              onClick={() => { const u = banner.undo!; setBanner(null); void run(u.action, u.groups, true); }}>Hoàn tác</button>
          ) : null}
        </div>
      ) : null}

      {chosen.length ? (
        <div className="inc-bulk" role="toolbar" aria-label="Thao tác với nhóm đã chọn">
          <span>Đã chọn {formatCount(chosen.length)} nhóm</span>
          {BULK_ACTIONS.map((action) => (
            <button key={action} type="button" disabled={busy}
              onClick={() => setPending({ action, groups: chosen })}>{ACTION_LABEL[action]}</button>
          ))}
        </div>
      ) : null}

      {pending ? (
        <div className="inc-confirm" role="alertdialog" aria-modal="false" aria-labelledby="inc-confirm-text">
          <p id="inc-confirm-text">{confirmText(pending.action, pending.groups)}</p>
          <button type="button" className="is-primary" disabled={busy}
            onClick={() => void run(pending.action, pending.groups)}>Xác nhận</button>
          <button type="button" disabled={busy} onClick={() => setPending(null)}>Huỷ</button>
        </div>
      ) : null}

      {loadError ? (
        <div className="inc-warning" role="alert">
          Chưa tải được hộp thư sự cố: {loadError}{' '}
          <button type="button" onClick={() => void load(current.current)}>Tải lại</button>
        </div>
      ) : null}

      {data && !items.length ? <p className="inc-empty">Không có nhóm nào ở bộ lọc này.</p> : null}

      {items.length ? (
        <table className="inc-table">
          <thead>
            <tr>
              <th scope="col">
                <input type="checkbox" aria-label="Chọn tất cả nhóm trên trang" checked={allChecked}
                  onChange={() => setSelected(allChecked ? new Set() : new Set(items.map(keyOf)))} />
              </th>
              <th scope="col">Sự cố</th>
              <th scope="col">Nguồn</th>
              <th scope="col">Học viên</th>
              <th scope="col">Số lần</th>
              <th scope="col">Lần cuối</th>
              <th scope="col">Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {items.map((g) => (
              <tr key={keyOf(g)} className={g.overdue ? 'is-overdue' : undefined}>
                <td>
                  <input type="checkbox" aria-label={`Chọn nhóm ${g.title}`} checked={selected.has(keyOf(g))}
                    onChange={() => toggle(g)} />
                </td>
                <td>
                  <a href={groupHref(g)} className="inc-title">{g.title}</a>
                  {g.area ? <div className="inc-area">{g.area}</div> : null}
                </td>
                <td>{SOURCE_LABEL[g.source]}</td>
                <td>{formatCount(g.learners)}</td>
                <td>{formatCount(g.count)}</td>
                <td>{formatWhen(g.last_at)}</td>
                <td>
                  <span className={`inc-chip is-${g.status}`}>{STATUS_LABEL[g.status]}</span>
                  {g.overdue ? <span className="inc-chip is-overdue">Quá hạn</span> : null}
                  {g.claimed_by_name ? <div className="inc-area">{g.claimed_by_name}</div> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {data && pages > 1 ? (
        <nav className="inc-pager" aria-label="Trang">
          <button type="button" disabled={state.page <= 1} onClick={() => go({ page: state.page - 1 })}>Trước</button>
          <span>Trang {state.page} / {pages}</span>
          <button type="button" disabled={state.page >= pages} onClick={() => go({ page: state.page + 1 })}>Sau</button>
        </nav>
      ) : null}
    </main>
  );
}
