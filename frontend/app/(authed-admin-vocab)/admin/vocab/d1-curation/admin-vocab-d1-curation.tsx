'use client';

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { useAdminProfile } from '@/components/admin-access-gate';
import {
  D1_ACTIVE_FILTERS,
  D1_SOURCES,
  d1Query,
  isUuid,
  normalizeD1ListPayload,
  normalizeD1PatchAck,
} from '@/lib/admin-vocab-curation-model.mjs';

type D1Row = {
  id: string;
  userId: string;
  vocabularyId: string;
  contextSentence: string;
  targetAnswer: string;
  acceptableVariants: string[];
  hint: string;
  sourceEvidenceSubstring: string;
  generatedBy: 'haiku' | 'gemini' | 'fallback_evidence';
  generatedAt: string;
  isActive: boolean;
  attemptCount: number;
  lastUsedAt: string;
  createdAt: string;
  headword: string;
};
type Filters = { source: string; active: string; userId: string };
type EditDraft = { contextSentence: string; targetAnswer: string; hint: string };
type Notice = { kind: 'success' | 'error'; message: string };

const PAGE_LIMIT = 50;
const messageOf = (value: unknown) => value instanceof Error ? value.message : String(value || 'lỗi không xác định');
const formatDate = (value: string) => {
  const date = new Date(value);
  return !value || Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
};

function initialFilters(params: ReturnType<typeof useSearchParams>): Filters {
  const source = params?.get('source') ?? '';
  const active = params?.get('active') ?? 'true';
  const userId = params?.get('user_id') ?? '';
  return {
    source: D1_SOURCES.includes(source) ? source : '',
    active: D1_ACTIVE_FILTERS.includes(active) ? active : 'true',
    userId,
  };
}

function mergeRows(current: D1Row[], incoming: D1Row[]) {
  const merged = new Map(current.map((row) => [row.id, row]));
  incoming.forEach((row) => merged.set(row.id, row));
  return [...merged.values()];
}

export function AdminVocabD1Curation() {
  const profile = useAdminProfile();
  const params = useSearchParams();
  const firstFilters = initialFilters(params);
  const [draftFilters, setDraftFilters] = useState<Filters>(firstFilters);
  const [filters, setFilters] = useState<Filters>(firstFilters);
  const [rows, setRows] = useState<D1Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [archiveRow, setArchiveRow] = useState<D1Row | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const sequence = useRef(0);
  const accountRef = useRef(profile.id);
  const mutationLock = useRef(false);
  accountRef.current = profile.id;

  const readList = useCallback(async (target: Filters, offset = 0, append = false) => {
    const query = d1Query({ ...target, offset, limit: PAGE_LIMIT });
    if (!query) {
      setError('Bộ lọc không hợp lệ. User ID phải là UUID nếu được nhập.');
      return false;
    }
    const requestId = ++sequence.current;
    const account = profile.id;
    if (append) setLoadingMore(true); else setLoading(true);
    setError(null);
    try {
      const payload = normalizeD1ListPayload(await window.api.get<unknown>(`/admin/vocab/d1-questions?${query}`));
      if (!payload) throw new Error('Backend trả về danh sách D1 không đúng định dạng.');
      if (requestId !== sequence.current || account !== accountRef.current) return false;
      setRows((current) => append ? mergeRows(current, payload.items as D1Row[]) : payload.items as D1Row[]);
      setTotal(payload.total);
      return true;
    } catch (caught) {
      if (requestId === sequence.current && account === accountRef.current) setError(`Không tải được D1 Curation: ${messageOf(caught)}`);
      return false;
    } finally {
      if (requestId === sequence.current && account === accountRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [profile.id]);

  useEffect(() => {
    setRows([]); setTotal(0); setNotice(null); setEditingId(null); setEditDraft(null);
    void readList(filters);
    return () => { sequence.current += 1; };
  }, [filters, profile.id, readList]);

  useEffect(() => {
    if (!archiveRow) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyId) { setArchiveRow(null); setArchiveError(null); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [archiveRow, busyId]);

  const applyFilters = () => {
    if (mutationLock.current) return;
    const userId = draftFilters.userId.trim();
    if (userId && !isUuid(userId)) {
      setError('User ID phải là UUID hợp lệ.');
      return;
    }
    const next = { ...draftFilters, userId };
    const url = new URL(window.location.href);
    for (const key of ['source', 'active', 'user_id']) url.searchParams.delete(key);
    if (next.source) url.searchParams.set('source', next.source);
    if (next.active) url.searchParams.set('active', next.active);
    if (next.userId) url.searchParams.set('user_id', next.userId);
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    setFilters(next);
  };

  const resetFilters = () => {
    if (mutationLock.current) return;
    const next = { source: '', active: 'true', userId: '' };
    setDraftFilters(next); setFilters(next);
    window.history.replaceState(null, '', window.location.pathname);
  };

  const startEdit = (row: D1Row) => {
    setEditingId(row.id);
    setEditDraft({ contextSentence: row.contextSentence, targetAnswer: row.targetAnswer, hint: row.hint });
    setNotice(null);
  };

  const refreshAfterWrite = async () => {
    setRows([]); setTotal(0);
    return readList(filters, 0, false);
  };

  const patchRow = async (row: D1Row, body: Record<string, unknown>, fields: string[], successMessage: string) => {
    if (mutationLock.current) return;
    mutationLock.current = true; setBusyId(row.id); setNotice(null);
    const account = profile.id;
    try {
      const result = await window.api.patch<unknown>(`/admin/vocab/d1-questions/${encodeURIComponent(row.id)}`, body);
      if (!normalizeD1PatchAck(result, row.id, fields)) throw new Error('Backend không xác nhận đúng các trường đã cập nhật.');
      if (account !== accountRef.current) return;
      if (!await refreshAfterWrite()) throw new Error('Write đã ACK nhưng canonical readback thất bại. Hãy tải lại trước khi thao tác tiếp.');
      setEditingId(null); setEditDraft(null);
      setNotice({ kind: 'success', message: successMessage });
    } catch (caught) {
      if (account === accountRef.current) setNotice({ kind: 'error', message: `Không xác nhận được trạng thái D1: ${messageOf(caught)}` });
    } finally {
      mutationLock.current = false;
      if (account === accountRef.current) setBusyId(null);
    }
  };

  const saveEdit = async (row: D1Row) => {
    if (!editDraft) return;
    const body = {
      context_sentence: editDraft.contextSentence.trim(),
      target_answer: editDraft.targetAnswer.trim(),
      hint: editDraft.hint.trim(),
    };
    if (!body.context_sentence || !body.target_answer) {
      setNotice({ kind: 'error', message: 'Context sentence và target answer không được trống.' });
      return;
    }
    await patchRow(row, body, ['context_sentence', 'target_answer', 'hint'], 'Đã lưu và tải lại danh sách D1 chuẩn từ backend.');
  };

  const archive = async () => {
    const row = archiveRow;
    if (!row || mutationLock.current) return;
    mutationLock.current = true; setBusyId(row.id); setNotice(null); setArchiveError(null);
    const account = profile.id;
    let acknowledged = false;
    try {
      await window.api.delete(`/admin/vocab/d1-questions/${encodeURIComponent(row.id)}`);
      acknowledged = true;
      if (account !== accountRef.current) return;
      setArchiveRow(null);
      if (!await refreshAfterWrite()) throw new Error('Delete đã trả về nhưng canonical readback thất bại. Hãy tải lại trước khi thao tác tiếp.');
      setNotice({ kind: 'success', message: 'Đã archive và tải lại danh sách D1 chuẩn từ backend.' });
    } catch (caught) {
      if (account === accountRef.current) {
        const message = `Không xác nhận được trạng thái archive: ${messageOf(caught)}`;
        if (acknowledged) setNotice({ kind: 'error', message }); else setArchiveError(message);
      }
    } finally {
      mutationLock.current = false;
      if (account === accountRef.current) setBusyId(null);
    }
  };

  return (
    <main className="avv-shell avv-console-shell">
      <header className="avv-stats-hero">
        <div><a href="/admin/vocab">← Vocabulary workspace</a><p className="avv-eyebrow">Kiểm duyệt cá nhân hoá</p><h1>D1 Curation</h1><p>Rà soát câu fill-blank theo đúng nguồn sinh, dữ liệu sử dụng và trạng thái lưu tại backend.</p></div>
        <div className="avv-console-count"><span>Đang hiển thị</span><strong>{rows.length}/{total}</strong></div>
      </header>

      <form className="avv-filterbar" onSubmit={(event) => { event.preventDefault(); applyFilters(); }}>
        <label>Source<select aria-label="Source" disabled={!!busyId} value={draftFilters.source} onChange={(event) => setDraftFilters((current) => ({ ...current, source: event.target.value }))}><option value="">Tất cả</option><option value="haiku">Haiku</option><option value="gemini">Gemini</option><option value="fallback_evidence">Fallback cần xem</option></select></label>
        <label>Trạng thái<select aria-label="Trạng thái" disabled={!!busyId} value={draftFilters.active} onChange={(event) => setDraftFilters((current) => ({ ...current, active: event.target.value }))}><option value="">Tất cả</option><option value="true">Active</option><option value="false">Archived</option></select></label>
        <label className="avv-filterbar__wide">User ID<input aria-label="User ID" disabled={!!busyId} value={draftFilters.userId} onChange={(event) => setDraftFilters((current) => ({ ...current, userId: event.target.value }))} placeholder="UUID (tuỳ chọn)" /></label>
        <div className="avv-filterbar__actions"><button className="btn-secondary" type="button" disabled={!!busyId} onClick={resetFilters}>Reset</button><button className="btn-primary" type="submit" disabled={!!busyId}>Tìm kiếm</button></div>
      </form>

      {notice ? <p className={`avv-banner is-${notice.kind}`} role="status">{notice.message}</p> : null}
      {error ? <p className="avv-banner is-error" role="alert">{error}</p> : null}
      {loading ? <div className="avv-state">Đang tải danh sách D1…</div> : rows.length === 0 ? <div className="avv-state">Không có câu hỏi phù hợp với bộ lọc.</div> : (
        <div className="avv-table-wrap">
          <table className="avv-table avv-d1-table">
            <thead><tr><th>Từ / context</th><th>Đáp án</th><th>Source</th><th>Attempts</th><th>Trạng thái</th><th>Created</th><th><span className="sr-only">Thao tác</span></th></tr></thead>
            <tbody>{rows.map((row) => {
              const editing = editingId === row.id && editDraft;
              return <Fragment key={row.id}>
                <tr>
                  <td data-label="Từ / context"><strong>{row.headword || '—'}</strong><p className="avv-mono-copy">{row.contextSentence}</p><small>User {row.userId}</small></td>
                  <td data-label="Đáp án"><strong className="avv-target">{row.targetAnswer}</strong>{row.hint ? <small>Hint: {row.hint}</small> : null}</td>
                  <td data-label="Source"><span className={`avv-chip is-${row.generatedBy === 'fallback_evidence' ? 'warning' : 'teal'}`}>{row.generatedBy === 'fallback_evidence' ? 'fallback' : row.generatedBy}</span></td>
                  <td data-label="Attempts">{row.attemptCount}</td>
                  <td data-label="Trạng thái"><span className={`avv-chip is-${row.isActive ? 'teal' : 'muted'}`}>{row.isActive ? 'active' : 'archived'}</span></td>
                  <td data-label="Created">{formatDate(row.createdAt)}</td>
                  <td className="avv-row-actions"><button className="btn-secondary" type="button" disabled={!!busyId} onClick={() => startEdit(row)}>Sửa</button>{row.isActive ? <button className="btn-danger" type="button" disabled={!!busyId} onClick={() => { setArchiveError(null); setArchiveRow(row); }}>Archive</button> : <button className="btn-secondary" type="button" disabled={!!busyId} onClick={() => void patchRow(row, { is_active: true }, ['is_active'], 'Đã restore và tải lại danh sách D1 chuẩn từ backend.')}>Restore</button>}</td>
                </tr>
                {editing ? <tr className="avv-edit-row"><td colSpan={7}><div className="avv-edit-grid"><label>Context sentence<textarea value={editDraft.contextSentence} onChange={(event) => setEditDraft((current) => current ? { ...current, contextSentence: event.target.value } : current)} /></label><label>Target answer<input value={editDraft.targetAnswer} onChange={(event) => setEditDraft((current) => current ? { ...current, targetAnswer: event.target.value } : current)} /></label><label>Hint<input value={editDraft.hint} onChange={(event) => setEditDraft((current) => current ? { ...current, hint: event.target.value } : current)} /></label><div className="avv-readonly-meta"><span>Vocab ID</span><code>{row.vocabularyId}</code><span>Generated</span><strong>{formatDate(row.generatedAt)}</strong></div></div><div className="avv-edit-actions"><button className="btn-secondary" type="button" disabled={busyId === row.id} onClick={() => { setEditingId(null); setEditDraft(null); }}>Đóng</button><button className="btn-primary" type="button" disabled={busyId === row.id} onClick={() => void saveEdit(row)}>{busyId === row.id ? 'Đang xác minh…' : 'Lưu thay đổi'}</button></div></td></tr> : null}
              </Fragment>;
            })}</tbody>
          </table>
        </div>
      )}
      {!loading && rows.length < total ? <button className="btn-secondary avv-load-more" type="button" disabled={loadingMore} onClick={() => void readList(filters, rows.length, true)}>{loadingMore ? 'Đang tải…' : 'Tải thêm'}</button> : null}

      {archiveRow ? <div className="av-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="d1-archive-title" onMouseDown={(event) => { if (event.target === event.currentTarget && !busyId) { setArchiveRow(null); setArchiveError(null); } }}><section className="av-modal avv-dialog-card"><p className="avv-eyebrow">Soft delete</p><h2 id="d1-archive-title">Archive câu hỏi D1?</h2><p>Attempt history vẫn được giữ. Câu hỏi sẽ ngừng xuất hiện trong pool active sau khi backend xác nhận.</p><strong>{archiveRow.headword || archiveRow.targetAnswer}</strong>{archiveError ? <p className="avv-banner is-error" role="alert">{archiveError}</p> : null}<div className="av-modal-footer"><button className="btn-secondary" type="button" disabled={!!busyId} onClick={() => { setArchiveRow(null); setArchiveError(null); }}>Hủy</button><button className="btn-danger" type="button" disabled={!!busyId} onClick={() => void archive()}>{busyId ? 'Đang xác minh…' : 'Archive'}</button></div></section></div> : null}
    </main>
  );
}
