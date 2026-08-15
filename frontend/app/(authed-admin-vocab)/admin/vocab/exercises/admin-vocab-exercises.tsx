'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { useAdminProfile } from '@/components/admin-access-gate';
import {
  EXERCISE_STATUSES,
  normalizeBulkAck,
  normalizeExerciseAck,
  normalizeExerciseList,
  normalizeGenerationAck,
  parseTargetWords,
  targetStatus,
} from '@/lib/admin-vocab-exercises-model.mjs';

type Status = 'draft' | 'published' | 'rejected';
type Action = 'publish' | 'reject' | 'unpublish';
type Exercise = {
  id: string;
  exerciseType: 'D1';
  status: Status;
  contentPayload: Record<string, unknown>;
  sentence: string;
  answer: string;
  distractors: string[];
  payloadComplete: boolean;
  createdAt: string;
  reviewedAt: string;
};
type Snapshot = Record<Status, Exercise[]>;
type Notice = { kind: 'success' | 'warning' | 'error'; message: string };
type ConfirmState = { action: Action; items: Exercise[] };

const LIMIT = 200;
const EMPTY_SNAPSHOT: Snapshot = { draft: [], published: [], rejected: [] };
const STATUS_LABELS: Record<Status, string> = { draft: 'Draft', published: 'Published', rejected: 'Rejected' };
const ACTION_LABELS: Record<Action, string> = { publish: 'Publish', reject: 'Reject', unpublish: 'Unpublish' };
const messageOf = (value: unknown) => value instanceof Error ? value.message : String(value || 'lỗi không xác định');
const formatDate = (value: string) => value ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';

export function AdminVocabExercises() {
  const profile = useAdminProfile();
  const params = useSearchParams();
  const requestedStatus = params?.get('status') ?? '';
  const initialStatus = EXERCISE_STATUSES.includes(requestedStatus) ? requestedStatus as Status : 'draft';
  const [status, setStatus] = useState<Status>(initialStatus);
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY_SNAPSHOT);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [confirmError, setConfirmError] = useState('');
  const [generateOpen, setGenerateOpen] = useState(false);
  const [wordsInput, setWordsInput] = useState('');
  const [generateCount, setGenerateCount] = useState('10');
  const [generateError, setGenerateError] = useState('');
  const sequence = useRef(0);
  const accountRef = useRef(profile.id);
  const mutationLock = useRef(false);
  accountRef.current = profile.id;

  const setStatusUrl = (next: Status) => {
    const url = new URL(window.location.href);
    url.searchParams.set('status', next);
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  };

  const fetchSnapshot = useCallback(async () => {
    const entries = await Promise.all(EXERCISE_STATUSES.map(async (item) => {
      const value = normalizeExerciseList(
        await window.api.get<unknown>(`/admin/exercises?status=${item}&exercise_type=D1&limit=${LIMIT}`),
        item,
        LIMIT,
      );
      if (!value) throw new Error(`Backend trả về queue ${item} không đúng định dạng.`);
      return [item, value] as const;
    }));
    return Object.fromEntries(entries) as Snapshot;
  }, []);

  const loadSnapshot = useCallback(async (clearNotice = true) => {
    const requestId = ++sequence.current; const account = profile.id;
    setLoading(true); if (clearNotice) setNotice(null);
    try {
      const next = await fetchSnapshot();
      if (requestId !== sequence.current || account !== accountRef.current) return null;
      setSnapshot(next); setSelected(new Set());
      return next;
    } catch (caught) {
      if (requestId === sequence.current && account === accountRef.current) setNotice({ kind: 'error', message: `Không tải được exercise queues: ${messageOf(caught)}` });
      return null;
    } finally {
      if (requestId === sequence.current && account === accountRef.current) setLoading(false);
    }
  }, [fetchSnapshot, profile.id]);

  useEffect(() => {
    const admitted = EXERCISE_STATUSES.includes(requestedStatus) ? requestedStatus as Status : 'draft';
    if (requestedStatus !== admitted) setStatusUrl(admitted);
    mutationLock.current = false; setBusy(false); setStatus(admitted); setSnapshot(EMPTY_SNAPSHOT);
    setSelected(new Set()); setNotice(null); setConfirmState(null); setConfirmError('');
    setGenerateOpen(false); setWordsInput(''); setGenerateCount('10'); setGenerateError('');
    void loadSnapshot();
    return () => { sequence.current += 1; };
  }, [profile.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!confirmState && !generateOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || busy) return;
      setConfirmState(null); setConfirmError(''); setGenerateOpen(false); setGenerateError('');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, confirmState, generateOpen]);

  const rows = snapshot[status];
  const selectedRows = useMemo(() => rows.filter((row) => selected.has(row.id)), [rows, selected]);
  const parsedWords = useMemo(() => parseTargetWords(wordsInput), [wordsInput]);
  const countLabel = (item: Status) => snapshot[item].length === LIMIT ? `${LIMIT}+` : String(snapshot[item].length);

  const chooseStatus = (next: Status) => {
    if (busy || next === status) return;
    setStatus(next); setSelected(new Set()); setNotice(null); setStatusUrl(next);
  };

  const onTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, current: Status) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = EXERCISE_STATUSES.indexOf(current);
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? EXERCISE_STATUSES.length - 1
      : event.key === 'ArrowRight' ? (index + 1) % EXERCISE_STATUSES.length : (index - 1 + EXERCISE_STATUSES.length) % EXERCISE_STATUSES.length;
    const next = EXERCISE_STATUSES[nextIndex] as Status;
    chooseStatus(next);
    document.getElementById(`avv-exercises-tab-${next}`)?.focus();
  };

  const toggleRow = (id: string) => setSelected((current) => {
    const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next;
  });
  const toggleAll = () => setSelected(selected.size === rows.length ? new Set() : new Set(rows.map((row) => row.id)));

  const requestAction = (action: Action, items: Exercise[]) => {
    if (!items.length || busy) return;
    setConfirmError(''); setConfirmState({ action, items });
  };

  const runAction = async () => {
    if (!confirmState || mutationLock.current) return;
    const target = confirmState; const account = profile.id;
    mutationLock.current = true; setBusy(true); setConfirmError(''); setNotice(null);
    let writeAttempted = false; let writeAcked = false;
    try {
      const ids = target.items.map((item) => item.id);
      writeAttempted = true;
      if (ids.length === 1) {
        const ack = normalizeExerciseAck(
          await window.api.patch<unknown>(`/admin/exercises/${encodeURIComponent(ids[0])}/${target.action}`, {}),
          ids[0],
          target.action,
        );
        if (!ack) throw new Error('Backend không ACK đúng exercise/status vừa đổi.');
      } else {
        if (!['publish', 'reject'].includes(target.action)) throw new Error('Bulk action không hợp lệ.');
        const ack = normalizeBulkAck(
          await window.api.post<unknown>('/admin/exercises/bulk', { ids, action: target.action }),
          ids,
          target.action,
        );
        if (!ack) throw new Error('Backend không ACK trọn vẹn toàn bộ selection.');
      }
      writeAcked = true;
      const canonical = await fetchSnapshot();
      if (account !== accountRef.current) return;
      setSnapshot(canonical); setSelected(new Set()); setConfirmState(null);
      setNotice({ kind: 'success', message: `Đã ${ACTION_LABELS[target.action].toLowerCase()} ${ids.length} exercise và tải lại cả ba queue chuẩn từ backend.` });
    } catch (caught) {
      if (account !== accountRef.current) return;
      if (writeAttempted) {
        setConfirmState(null);
        setNotice({ kind: 'error', message: `${writeAcked ? 'Backend đã ACK nhưng canonical queues chưa tải lại được' : 'Không xác định status write đã tới backend hay chưa'}: ${messageOf(caught)} Hãy reload queue; không gửi lại action trước khi kiểm tra.` });
      } else setConfirmError(`Không thể thực hiện action: ${messageOf(caught)}`);
    } finally {
      mutationLock.current = false; if (account === accountRef.current) setBusy(false);
    }
  };

  const openGenerate = () => {
    if (loading || busy) return;
    setWordsInput(''); setGenerateCount('10'); setGenerateError(''); setGenerateOpen(true); setNotice(null);
  };

  const runGenerate = async () => {
    if (loading || mutationLock.current) return;
    const count = Number(generateCount);
    if (!parsedWords.length) { setGenerateError('Cần ít nhất một target word.'); return; }
    if (parsedWords.length > 100) { setGenerateError('Tối đa 100 target words cho một request.'); return; }
    if (!Number.isInteger(count) || count < 1 || count > 100) { setGenerateError('Số draft phải là số nguyên từ 1 đến 100.'); return; }
    if (count > parsedWords.length) { setGenerateError(`Số draft không được vượt quá ${parsedWords.length} target words duy nhất.`); return; }
    const account = profile.id; mutationLock.current = true; setBusy(true); setGenerateError(''); setNotice(null);
    let writeAttempted = false; let writeAcked = false;
    try {
      writeAttempted = true;
      const ack = normalizeGenerationAck(
        await window.api.post<unknown>('/admin/exercises/d1/generate-batch', { words: parsedWords, count }),
        parsedWords,
        count,
      );
      if (!ack) throw new Error('Backend không trả về summary generation đúng contract.');
      writeAcked = true;
      const canonical = await fetchSnapshot();
      if (account !== accountRef.current) return;
      setSnapshot(canonical); setSelected(new Set()); setGenerateOpen(false); setWordsInput('');
      setNotice({
        kind: ack.status === 'partial' ? 'warning' : 'success',
        message: `${ack.message} Đã đọc lại queue draft canonical. Job ${ack.jobId}; chi phí ước tính $${ack.estimatedCostUsd.toFixed(4)}.`,
      });
    } catch (caught) {
      if (account !== accountRef.current) return;
      if (writeAttempted) {
        setGenerateOpen(false); setWordsInput('');
        setNotice({ kind: 'error', message: `${writeAcked ? 'Backend đã ACK generation nhưng queue readback chưa hoàn tất' : 'Không xác định Gemini request đã hoàn tất hay chưa'}: ${messageOf(caught)} Đây là write có chi phí; reload Draft và không tự động gửi lại.` });
      } else setGenerateError(`Không thể generate: ${messageOf(caught)}`);
    } finally {
      mutationLock.current = false; if (account === accountRef.current) setBusy(false);
    }
  };

  return <main className="avv-shell avv-console-shell avv-exercises-console">
    <header className="avv-stats-hero">
      <div><a href="/admin/vocab">← Vocabulary workspace</a><p className="avv-eyebrow">Admin pool · D1</p><h1>Vocab Exercises</h1><p>Duyệt draft trước khi phát hành. Đây là pool chung, tách biệt với câu D1 cá nhân hoá trong Curation.</p></div>
      <div className="avv-exercises-hero-actions"><button className="btn-secondary" type="button" disabled={busy || loading} onClick={() => void loadSnapshot()}>↻ Làm mới</button><button className="btn-primary" type="button" disabled={busy || loading} onClick={openGenerate}>+ Generate batch</button></div>
    </header>

    {notice ? <p className={`avv-banner is-${notice.kind}`} role={notice.kind === 'success' ? 'status' : 'alert'}>{notice.message}</p> : null}

    <section className="avv-exercises-board">
      <div className="avv-exercises-tabs" role="tablist" aria-label="Lọc exercise theo trạng thái">
        {EXERCISE_STATUSES.map((item) => <button id={`avv-exercises-tab-${item}`} key={item} role="tab" aria-selected={status === item} tabIndex={status === item ? 0 : -1} className={status === item ? 'is-active' : ''} type="button" disabled={busy} onClick={() => chooseStatus(item as Status)} onKeyDown={(event) => onTabKeyDown(event, item as Status)}><span>{STATUS_LABELS[item as Status]}</span><b>{countLabel(item as Status)}</b></button>)}
      </div>

      <div className="avv-exercises-bulk">
        <label className="avv-check"><input type="checkbox" checked={rows.length > 0 && selected.size === rows.length} ref={(node) => { if (node) node.indeterminate = selected.size > 0 && selected.size < rows.length; }} disabled={busy || !rows.length} onChange={toggleAll} />Chọn toàn bộ queue đang hiển thị</label>
        <span>{selected.size ? `${selected.size} exercise đã chọn` : 'Chưa chọn exercise'}</span>
        <div><button className="btn-secondary" type="button" disabled={busy || !selectedRows.length} onClick={() => requestAction('publish', selectedRows)}>Publish ({selectedRows.length})</button><button className="btn-danger" type="button" disabled={busy || !selectedRows.length} onClick={() => requestAction('reject', selectedRows)}>Reject ({selectedRows.length})</button></div>
      </div>

      <p className="avv-exercises-cap">Mỗi queue hiển thị tối đa {LIMIT} exercise mới nhất; “{LIMIT}+” nghĩa là có thể còn dữ liệu ngoài cửa sổ API hiện tại.</p>
      {loading ? <div className="avv-state">Đang tải đồng thời ba queue chuẩn…</div> : rows.length === 0 ? <div className="avv-state">Không có exercise trong queue {STATUS_LABELS[status]}.</div> : <div className="avv-table-wrap"><table className="avv-table avv-exercises-table"><thead><tr><th><span className="sr-only">Chọn</span></th><th>Câu hỏi</th><th>Đáp án</th><th>Review</th><th><span className="sr-only">Thao tác</span></th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td data-label="Chọn"><input aria-label={`Chọn exercise ${row.id}`} type="checkbox" checked={selected.has(row.id)} disabled={busy} onChange={() => toggleRow(row.id)} /></td><td data-label="Câu hỏi"><strong>{row.sentence || '(thiếu sentence)'}</strong><small>{row.id}</small>{!row.payloadComplete ? <span className="avv-chip is-warning">payload chưa đầy đủ</span> : null}</td><td data-label="Đáp án"><strong>{row.answer || '(thiếu answer/word)'}</strong><small>{row.distractors.length ? `Distractors: ${row.distractors.join(', ')}` : 'Thiếu distractors'}</small></td><td data-label="Review"><span className={`avv-chip is-${row.status === 'published' ? 'teal' : row.status === 'rejected' ? 'warning' : 'muted'}`}>{row.status}</span><small>{row.reviewedAt ? `Review ${formatDate(row.reviewedAt)}` : `Tạo ${formatDate(row.createdAt)}`}</small></td><td className="avv-row-actions">{row.status === 'published' ? <button className="btn-secondary" type="button" disabled={busy} onClick={() => requestAction('unpublish', [row])}>Unpublish</button> : <><button className="btn-secondary" type="button" disabled={busy} onClick={() => requestAction('publish', [row])}>Publish</button>{row.status === 'draft' ? <button className="btn-danger" type="button" disabled={busy} onClick={() => requestAction('reject', [row])}>Reject</button> : null}</>}</td></tr>)}</tbody></table></div>}
    </section>

    {confirmState ? <div className="av-modal-backdrop avv-dialog" role="dialog" aria-modal="true" aria-labelledby="avv-exercises-confirm-title" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setConfirmState(null); }}><div className="av-modal avv-dialog-card"><p className="avv-eyebrow">Canonical status write</p><h2 id="avv-exercises-confirm-title" className="av-modal-title">{ACTION_LABELS[confirmState.action]} {confirmState.items.length} exercise?</h2><p>Backend sẽ chuyển selection sang <strong>{targetStatus(confirmState.action)}</strong>. Sau ACK, cả ba queue sẽ được tải lại trước khi báo hoàn tất.</p><div className="avv-confirm-list">{confirmState.items.slice(0, 8).map((item) => <span key={item.id}>{item.answer || item.id}</span>)}{confirmState.items.length > 8 ? <span>+{confirmState.items.length - 8} exercise khác</span> : null}</div>{confirmError ? <p className="avv-banner is-error" role="alert">{confirmError}</p> : null}<div className="av-modal-footer"><button className="btn-secondary" type="button" disabled={busy} onClick={() => { setConfirmState(null); setConfirmError(''); }}>Hủy</button><button className={confirmState.action === 'reject' ? 'btn-danger' : 'btn-primary'} type="button" disabled={busy} onClick={() => void runAction()}>{busy ? 'Đang xác minh…' : 'Xác nhận'}</button></div></div></div> : null}

    {generateOpen ? <div className="av-modal-backdrop avv-dialog" role="dialog" aria-modal="true" aria-labelledby="avv-exercises-generate-title" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setGenerateOpen(false); }}><div className="av-modal avv-dialog-card avv-exercises-generate"><p className="avv-eyebrow">Gemini · synchronous chunks</p><h2 id="avv-exercises-generate-title" className="av-modal-title">Generate D1 drafts</h2><p>Request chạy đồng bộ theo chunk 10 từ và có thể mất gần 120 giây. Giữ tab mở; hệ thống có thể trả về kết quả <strong>partial</strong>. Không tự động retry vì đây là thao tác có chi phí.</p><label>Target words<textarea value={wordsInput} disabled={busy} placeholder="mitigate, sustainable, leverage" onChange={(event) => setWordsInput(event.target.value)} /></label><div className="avv-exercises-generate-meta"><label>Số draft<input type="number" min="1" max="100" value={generateCount} disabled={busy} onChange={(event) => setGenerateCount(event.target.value)} /></label><div><span>Target duy nhất</span><strong>{parsedWords.length}</strong></div><div><span>Chi phí ước tính</span><strong>${(Math.max(0, Number(generateCount) || 0) * 0.0005).toFixed(4)}</strong></div></div>{busy ? <p className="avv-banner is-warning" role="status">Gemini đang tạo và ghi từng chunk. Không đóng tab hoặc gửi lại request.</p> : null}{generateError ? <p className="avv-banner is-error" role="alert">{generateError}</p> : null}<div className="av-modal-footer"><button className="btn-secondary" type="button" disabled={busy} onClick={() => { setGenerateOpen(false); setGenerateError(''); }}>Hủy</button><button className="btn-primary" type="button" disabled={busy} onClick={() => void runGenerate()}>{busy ? 'Đang chờ Gemini…' : 'Generate và chờ kết quả'}</button></div></div></div> : null}
  </main>;
}
