'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { useAdminProfile } from '@/components/admin-access-gate';
import {
  LEMMA_POS_TAGS,
  isUuid,
  lemmaQuery,
  normalizeLemmaCreateAck,
  normalizeLemmaListPayload,
} from '@/lib/admin-vocab-curation-model.mjs';

type LemmaRow = { id: string; originalWord: string; lemma: string; posTag: string; notes: string; createdAt: string };
type Draft = { originalWord: string; lemma: string; posTag: string; notes: string };
type Notice = { kind: 'success' | 'error'; message: string };

const PAGE_LIMIT = 100;
const EMPTY_DRAFT: Draft = { originalWord: '', lemma: '', posTag: '', notes: '' };
const messageOf = (value: unknown) => value instanceof Error ? value.message : String(value || 'lỗi không xác định');
const formatDate = (value: string) => {
  const date = new Date(value);
  return !value || Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('vi-VN');
};

function mergeRows(current: LemmaRow[], incoming: LemmaRow[]) {
  const merged = new Map(current.map((row) => [row.id, row]));
  incoming.forEach((row) => merged.set(row.id, row));
  return [...merged.values()];
}
export function AdminVocabLemmas() {
  const profile = useAdminProfile();
  const params = useSearchParams();
  const initialSearch = params?.get('search') ?? '';
  const [draftSearch, setDraftSearch] = useState(initialSearch);
  const [search, setSearch] = useState(initialSearch);
  const [rows, setRows] = useState<LemmaRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [deleteRow, setDeleteRow] = useState<LemmaRow | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  const accountRef = useRef(profile.id);
  const mutationLock = useRef(false);
  accountRef.current = profile.id;

  const readList = useCallback(async (targetSearch: string, offset = 0, append = false) => {
    const query = lemmaQuery({ search: targetSearch, offset, limit: PAGE_LIMIT });
    if (!query) { setError('Bộ lọc lemma không hợp lệ.'); return false; }
    const requestId = ++sequence.current;
    const account = profile.id;
    if (append) setLoadingMore(true); else setLoading(true);
    setError(null);
    try {
      const payload = normalizeLemmaListPayload(await window.api.get<unknown>(`/admin/vocab/lemmas/overrides?${query}`));
      if (!payload) throw new Error('Backend trả về danh sách lemma không đúng định dạng.');
      if (requestId !== sequence.current || account !== accountRef.current) return false;
      setRows((current) => append ? mergeRows(current, payload.items as LemmaRow[]) : payload.items as LemmaRow[]);
      setTotal(payload.total);
      return true;
    } catch (caught) {
      if (requestId === sequence.current && account === accountRef.current) setError(`Không tải được Lemma Overrides: ${messageOf(caught)}`);
      return false;
    } finally {
      if (requestId === sequence.current && account === accountRef.current) {
        setLoading(false); setLoadingMore(false);
      }
    }
  }, [profile.id]);

  useEffect(() => {
    setRows([]); setTotal(0); setNotice(null);
    void readList(search);
    return () => { sequence.current += 1; };
  }, [profile.id, readList, search]);

  useEffect(() => {
    if (!createOpen && !deleteRow) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || busy) return;
      setCreateOpen(false); setCreateError(null); setDeleteRow(null); setDeleteError(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, createOpen, deleteRow]);

  const applySearch = () => {
    if (mutationLock.current) return;
    const canonical = draftSearch.trim();
    const url = new URL(window.location.href);
    if (canonical) url.searchParams.set('search', canonical); else url.searchParams.delete('search');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    setSearch(canonical);
  };

  const refreshAfterWrite = async () => {
    setRows([]); setTotal(0);
    return readList(search, 0, false);
  };

  const createOverride = async () => {
    if (mutationLock.current) return;
    const body = {
      original_word: draft.originalWord.trim(),
      lemma: draft.lemma.trim(),
      pos_tag: draft.posTag || null,
      notes: draft.notes.trim() || null,
    };
    if (!body.original_word || !body.lemma) {
      setCreateError('Original word và lemma không được trống.');
      return;
    }
    if (!LEMMA_POS_TAGS.includes(draft.posTag)) {
      setCreateError('POS tag không hợp lệ.');
      return;
    }
    mutationLock.current = true; setBusy(true); setNotice(null); setCreateError(null);
    const account = profile.id;
    let acknowledged = false;
    try {
      const ack = normalizeLemmaCreateAck(await window.api.post<unknown>('/admin/vocab/lemmas/overrides', body));
      if (!ack) throw new Error('Backend không trả xác nhận tạo override hợp lệ.');
      acknowledged = true;
      if (account !== accountRef.current) return;
      setCreateOpen(false); setDraft(EMPTY_DRAFT);
      if (!await refreshAfterWrite()) throw new Error('Create đã ACK nhưng canonical readback thất bại. Hãy tải lại trước khi thao tác tiếp.');
      setNotice({ kind: 'success', message: 'Đã tạo override và tải lại danh sách chuẩn từ backend.' });
    } catch (caught) {
      if (account === accountRef.current) {
        const message = `Không xác nhận được trạng thái override: ${messageOf(caught)}`;
        if (acknowledged) setNotice({ kind: 'error', message }); else setCreateError(message);
      }
    } finally {
      mutationLock.current = false;
      if (account === accountRef.current) setBusy(false);
    }
  };

  const removeOverride = async () => {
    const row = deleteRow;
    if (!row || !isUuid(row.id) || mutationLock.current) return;
    mutationLock.current = true; setBusy(true); setNotice(null); setDeleteError(null);
    const account = profile.id;
    let acknowledged = false;
    try {
      await window.api.delete(`/admin/vocab/lemmas/overrides/${encodeURIComponent(row.id)}`);
      acknowledged = true;
      if (account !== accountRef.current) return;
      setDeleteRow(null);
      if (!await refreshAfterWrite()) throw new Error('Delete đã trả về nhưng canonical readback thất bại. Hãy tải lại trước khi thao tác tiếp.');
      setNotice({ kind: 'success', message: 'Đã xoá override và tải lại danh sách chuẩn từ backend.' });
    } catch (caught) {
      if (account === accountRef.current) {
        const message = `Không xác nhận được trạng thái xoá: ${messageOf(caught)}`;
        if (acknowledged) setNotice({ kind: 'error', message }); else setDeleteError(message);
      }
    } finally {
      mutationLock.current = false;
      if (account === accountRef.current) setBusy(false);
    }
  };

  return (
    <main className="avv-shell avv-console-shell">
      <header className="avv-stats-hero">
        <div><a href="/admin/vocab">← Vocabulary workspace</a><p className="avv-eyebrow">Chuẩn hoá ngôn ngữ</p><h1>Lemma Overrides</h1><p>Quản lý mapping thủ công cho idiom, proper noun và các trường hợp lemmatizer nhận sai.</p></div>
        <div className="avv-console-count"><span>Đang hiển thị</span><strong>{rows.length}/{total}</strong></div>
      </header>

      <form className="avv-searchbar" onSubmit={(event) => { event.preventDefault(); applySearch(); }}>
        <label><span className="sr-only">Tìm original word</span><input aria-label="Tìm original word" disabled={busy} value={draftSearch} onChange={(event) => setDraftSearch(event.target.value)} placeholder="Tìm theo original word (prefix match)…" /></label>
        <button className="btn-secondary" type="submit" disabled={busy}>Tìm</button>
        <button className="btn-primary" type="button" disabled={busy} onClick={() => { setDraft(EMPTY_DRAFT); setNotice(null); setCreateError(null); setCreateOpen(true); }}>+ Thêm override</button>
      </form>

      {notice ? <p className={`avv-banner is-${notice.kind}`} role="status">{notice.message}</p> : null}
      {error ? <p className="avv-banner is-error" role="alert">{error}</p> : null}
      {loading ? <div className="avv-state">Đang tải lemma overrides…</div> : rows.length === 0 ? <div className="avv-state">Chưa có override phù hợp.</div> : (
        <div className="avv-table-wrap">
          <table className="avv-table avv-lemma-table">
            <thead><tr><th>Original word</th><th><span className="sr-only">Mapping</span></th><th>Lemma</th><th>POS</th><th>Notes</th><th>Created</th><th><span className="sr-only">Thao tác</span></th></tr></thead>
            <tbody>{rows.map((row) => <tr key={row.id}><td data-label="Original word"><strong className="avv-mono-copy">{row.originalWord}</strong></td><td className="avv-map-arrow" aria-hidden="true">→</td><td data-label="Lemma"><strong className="avv-mono-copy">{row.lemma}</strong></td><td data-label="POS">{row.posTag || '—'}</td><td data-label="Notes">{row.notes || '—'}</td><td data-label="Created">{formatDate(row.createdAt)}</td><td className="avv-row-actions"><button className="btn-danger" type="button" disabled={busy} onClick={() => { setDeleteError(null); setDeleteRow(row); }}>Xoá</button></td></tr>)}</tbody>
          </table>
        </div>
      )}
      {!loading && rows.length < total ? <button className="btn-secondary avv-load-more" type="button" disabled={loadingMore} onClick={() => void readList(search, rows.length, true)}>{loadingMore ? 'Đang tải…' : 'Tải thêm'}</button> : null}

      {createOpen ? <div className="av-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="lemma-create-title" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) { setCreateOpen(false); setCreateError(null); } }}><section className="av-modal avv-dialog-card"><p className="avv-eyebrow">Manual mapping</p><h2 id="lemma-create-title">Thêm lemma override</h2><label>Original word<input autoFocus value={draft.originalWord} maxLength={200} onChange={(event) => setDraft((current) => ({ ...current, originalWord: event.target.value }))} placeholder="VD: phở" /></label><label>Lemma (canonical form)<input value={draft.lemma} maxLength={200} onChange={(event) => setDraft((current) => ({ ...current, lemma: event.target.value }))} placeholder="VD: phở" /></label><label>POS (tuỳ chọn)<select value={draft.posTag} onChange={(event) => setDraft((current) => ({ ...current, posTag: event.target.value }))}><option value="">Để lemmatizer phân loại</option>{LEMMA_POS_TAGS.filter(Boolean).map((tag) => <option key={tag} value={tag}>{tag}</option>)}</select></label><label>Notes (tuỳ chọn)<textarea rows={3} value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} placeholder="Lý do override…" /></label>{createError ? <p className="avv-banner is-error" role="alert">{createError}</p> : null}<div className="av-modal-footer"><button className="btn-secondary" type="button" disabled={busy} onClick={() => { setCreateOpen(false); setCreateError(null); }}>Hủy</button><button className="btn-primary" type="button" disabled={busy} onClick={() => void createOverride()}>{busy ? 'Đang xác minh…' : 'Lưu override'}</button></div></section></div> : null}
      {deleteRow ? <div className="av-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="lemma-delete-title" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) { setDeleteRow(null); setDeleteError(null); } }}><section className="av-modal avv-dialog-card"><p className="avv-eyebrow">Xác nhận thay đổi</p><h2 id="lemma-delete-title">Xoá override?</h2><p>Lemmatizer sẽ quay lại cơ chế mặc định cho từ này sau khi backend reload mapping.</p><strong className="avv-mono-copy">{deleteRow.originalWord} → {deleteRow.lemma}</strong>{deleteError ? <p className="avv-banner is-error" role="alert">{deleteError}</p> : null}<div className="av-modal-footer"><button className="btn-secondary" type="button" disabled={busy} onClick={() => { setDeleteRow(null); setDeleteError(null); }}>Hủy</button><button className="btn-danger" type="button" disabled={busy} onClick={() => void removeOverride()}>{busy ? 'Đang xác minh…' : 'Xoá override'}</button></div></section></div> : null}
    </main>
  );
}
