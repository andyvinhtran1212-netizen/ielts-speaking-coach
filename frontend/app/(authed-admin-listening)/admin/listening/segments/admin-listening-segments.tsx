'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useAdminProfile } from '@/components/admin-access-gate';
import { Dialog } from '@/components/admin-directory-ui';
import {
  assignListeningAlignmentTimestamps, assignListeningProportionalTimestamps,
  buildListeningSegmentOperation, findListeningSegmentOperationMatch,
  formatListeningSegmentTime, listeningSegmentDraft, listeningSegmentsHref,
  listeningSegmentsRollbackHref, MAX_LISTENING_SEGMENTS, normalizeListeningDictationBlocks,
  normalizeListeningSegmentContent, normalizePendingListeningSegmentSave,
  parseListeningSegmentTime, splitListeningTranscript,
} from '@/lib/admin-listening-segments-model.mjs';

type Content = { id: string; title: string; transcript: string; durationSeconds: number; status: 'draft' | 'published' | 'archived'; audioUrl: string | null; sourceType: string | null; alignment: unknown };
type Segment = { transcript: string; startSec: number; endSec: number };
type SegmentInput = { transcript: string; startText: string; endText: string };
type Block = { id: string; contentId: string; orderNum: number; status: 'draft' | 'published' | 'archived'; updatedAt: string; segments: Array<Segment & { idx: number }> };
type Collection = { items: Block[]; malformedCount: number; duplicateOrders: number[] };
type Pending = { account: string; contentId: string; startedAt: string; operation: Record<string, unknown> };
type Banner = { kind: 'success' | 'warning' | 'error'; title: string; text: string } | null;
type Confirm = 'parse' | 'delete' | 'leave' | 'reload' | 'discard-pending' | 'switch' | 'new-block' | null;
type AudioElement = HTMLElement & { getCurrentTime?: () => number | null; play?: () => Promise<void> | void; pause?: () => void; reset?: () => void };

const STATUS_LABEL: Record<string, string> = { draft: 'Bản nháp', published: 'Đã xuất bản', archived: 'Đã lưu trữ' };
const messageOf = (caught: unknown) => caught instanceof Error ? caught.message : String(caught || 'Lỗi không xác định');
const statusOf = (caught: unknown) => Number((caught as { status?: number; statusCode?: number })?.status || (caught as { statusCode?: number })?.statusCode || 0);
const definitive = (status: number) => [400, 401, 403, 404, 409, 422].includes(status);
const receiptKey = (account: string, contentId: string) => `alse-pending:${account}:${contentId}`;
const readReceipt = (key: string) => { try { return sessionStorage.getItem(key); } catch { return null; } };
const writeReceipt = (key: string, value: string) => { try { sessionStorage.setItem(key, value); return sessionStorage.getItem(key) === value; } catch { return false; } };
const clearReceipt = (key: string) => { try { sessionStorage.removeItem(key); } catch { /* storage unavailable */ } };
const toInputs = (segments: Segment[]) => segments.map((item) => ({ transcript: item.transcript, startText: formatListeningSegmentTime(item.startSec), endText: formatListeningSegmentTime(item.endSec) }));
const semantic = (draft: SegmentInput[]) => draft.map((item) => ({ transcript: item.transcript, startSec: parseListeningSegmentTime(item.startText), endSec: parseListeningSegmentTime(item.endText) }));
const fingerprint = (draft: SegmentInput[]) => JSON.stringify(draft.map((item) => ({ transcript: item.transcript, start: item.startText.trim(), end: item.endText.trim() })));

export function AdminListeningSegments({ contentId, requestedExerciseId }: { contentId: string; requestedExerciseId: string | null }) {
  const profile = useAdminProfile();
  const requestOrder = useRef(0);
  const account = useRef(profile.id);
  const leaving = useRef(false);
  const audioRef = useRef<AudioElement | null>(null);
  const [content, setContent] = useState<Content | null>(null);
  const [collection, setCollection] = useState<Collection | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<Block | null>(null);
  const [newOrderNum, setNewOrderNum] = useState<number | null>(null);
  const [draft, setDraft] = useState<SegmentInput[]>([]);
  const [targetStatus, setTargetStatus] = useState<'draft' | 'published' | 'archived'>('draft');
  const [transcriptText, setTranscriptText] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [conflict, setConflict] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<Banner>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [deleteIndex, setDeleteIndex] = useState<number | null>(null);
  const [switchTarget, setSwitchTarget] = useState<string | null>(null);

  const orderNum = baseline?.orderNum || newOrderNum || 1;
  const initialDraft = useMemo(() => baseline ? toInputs(listeningSegmentDraft(baseline) as Segment[]) : [], [baseline]);
  const dirty = baseline
    ? fingerprint(draft) !== fingerprint(initialDraft) || targetStatus !== baseline.status
    : draft.length > 0;
  const locked = busy || Boolean(pending) || conflict
    || Boolean(collection?.duplicateOrders.length) || Boolean(collection?.malformedCount);

  const readCollection = useCallback(async () => {
    const raw = await window.api.get<unknown>(`/admin/listening/exercises?content_id=${encodeURIComponent(contentId)}&exercise_type=dictation`);
    const value = normalizeListeningDictationBlocks(raw, contentId) as Collection | null;
    if (!value) throw new Error('Danh sách Dictation không đúng contract canonical.');
    return value;
  }, [contentId]);

  const install = useCallback((block: Block | null, nextCollection: Collection) => {
    setCollection(nextCollection); setBaseline(block); setSelectedId(block?.id || null);
    setNewOrderNum(null);
    setDraft(block ? toInputs(listeningSegmentDraft(block) as Segment[]) : []);
    setTargetStatus(block?.status || 'draft');
    setRowErrors({}); setConflict(false);
    const url = listeningSegmentsHref(contentId, block?.id || null);
    window.history.replaceState(null, '', url);
  }, [contentId]);

  const load = useCallback(async () => {
    const request = ++requestOrder.current;
    account.current = profile.id;
    setLoading(true); setLoadError(null); setBanner(null); setPending(null); setConflict(false);
    if (!contentId) { setLoadError('Thiếu content_id. Hãy mở editor từ inventory hoặc trang chi tiết nội dung.'); setLoading(false); return; }
    try {
      const [rawContent, nextCollection] = await Promise.all([
        window.api.get<unknown>(`/admin/listening/content/${encodeURIComponent(contentId)}`),
        readCollection(),
      ]);
      const nextContent = normalizeListeningSegmentContent(rawContent, contentId) as Content | null;
      if (!nextContent) throw new Error('Nội dung Listening không đúng contract canonical.');
      if (request !== requestOrder.current || account.current !== profile.id) return;
      if (nextCollection.duplicateOrders.length) throw new Error(`Có nhiều Dictation block trùng order ${nextCollection.duplicateOrders.join(', ')}; cần sửa dữ liệu trước khi authoring.`);
      if (nextCollection.malformedCount) throw new Error(`Có ${nextCollection.malformedCount} Dictation row sai contract. Editor khóa để không tạo block đè lên order đang tồn tại; hãy sửa dữ liệu hoặc mở HTML rollback.`);
      let block = requestedExerciseId ? nextCollection.items.find((item) => item.id === requestedExerciseId) || null : nextCollection.items.find((item) => item.orderNum === 1) || nextCollection.items[0] || null;
      if (requestedExerciseId && !block) throw new Error('exercise_id không thuộc content Dictation này.');
      setContent(nextContent); setTranscriptText(nextContent.transcript); install(block, nextCollection);
      const key = receiptKey(profile.id, contentId);
      let restored: Pending | null = null;
      try { restored = normalizePendingListeningSegmentSave(JSON.parse(readReceipt(key) || 'null'), profile.id, contentId) as Pending | null; } catch { clearReceipt(key); }
      const matched = restored ? findListeningSegmentOperationMatch(nextCollection, restored.operation) as Block | null : null;
      if (matched) {
        clearReceipt(key); install(matched, nextCollection);
        setBanner({ kind: 'success', title: 'Đã đối chiếu lượt lưu trước', text: 'Canonical GET chứa đúng block và segments; hệ thống không gửi lại POST.' });
      } else if (restored) {
        setPending(restored);
        setBanner({ kind: 'warning', title: 'Có lượt lưu chưa đối chiếu', text: 'Editor đang khóa. Chỉ GET lại canonical hoặc bỏ biên nhận sau khi kiểm tra; không tự phát lại POST.' });
      }
    } catch (caught) {
      if (request === requestOrder.current) setLoadError(messageOf(caught));
    } finally { if (request === requestOrder.current) setLoading(false); }
  }, [contentId, install, profile.id, readCollection, requestedExerciseId]);

  useEffect(() => { void load(); return () => { requestOrder.current += 1; }; }, [load]);
  useEffect(() => {
    if (!dirty && !pending) return;
    const warn = (event: BeforeUnloadEvent) => { if (leaving.current) return; event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, pending]);

  const parseTranscript = () => {
    if (!content) return;
    const sentences = splitListeningTranscript(transcriptText);
    if (!sentences.length) { setBanner({ kind: 'error', title: 'Không thể phân câu', text: 'Transcript không có câu hợp lệ.' }); return; }
    if (sentences.length > MAX_LISTENING_SEGMENTS) { setBanner({ kind: 'error', title: 'Transcript quá dài', text: `Có ${sentences.length} câu; tối đa ${MAX_LISTENING_SEGMENTS}. Hãy chia thành nhiều block trước khi tiếp tục.` }); return; }
    const aligned = assignListeningAlignmentTimestamps(sentences, content.alignment);
    const segments = aligned || assignListeningProportionalTimestamps(sentences, content.durationSeconds);
    setDraft(toInputs(segments as Segment[])); setRowErrors({});
    setBanner({ kind: 'success', title: `Đã tạo ${segments.length} câu`, text: aligned ? 'Timestamp lấy từ alignment canonical; hãy nghe kiểm tra từng ranh giới.' : 'Timestamp được ước tính theo tỷ lệ ký tự; cần nghe và tinh chỉnh trước khi publish.' });
  };

  const updateRow = (index: number, patch: Partial<SegmentInput>) => setDraft((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  const mark = (index: number, field: 'startText' | 'endText') => {
    const currentTime = audioRef.current?.getCurrentTime?.();
    if (currentTime == null) { setBanner({ kind: 'error', title: 'Chưa đọc được vị trí audio', text: 'Hãy phát hoặc tua audio tới điểm cắt rồi thử lại.' }); return; }
    updateRow(index, { [field]: formatListeningSegmentTime(currentTime) });
  };
  const preview = (index: number) => {
    const value = semantic(draft)[index];
    if (!value || value.startSec == null || value.endSec == null || value.endSec <= value.startSec || !audioRef.current) return;
    audioRef.current.setAttribute('segment-start', String(value.startSec));
    audioRef.current.setAttribute('segment-end', String(value.endSec));
    audioRef.current.reset?.(); void audioRef.current.play?.();
  };
  const fullTrack = () => { audioRef.current?.pause?.(); audioRef.current?.removeAttribute('segment-start'); audioRef.current?.removeAttribute('segment-end'); audioRef.current?.reset?.(); };

  const save = async (status: 'draft' | 'published' | 'archived') => {
    if (!content || !collection || locked) return;
    const result = buildListeningSegmentOperation({ contentId, block: baseline, orderNum, draft: semantic(draft), durationSeconds: content.durationSeconds, status }) as { ok: boolean; errors: Record<string, string>; operation: Record<string, unknown> | null };
    setRowErrors(result.errors || {});
    if (!result.ok || !result.operation) { setBanner({ kind: 'error', title: 'Chưa thể lưu', text: result.errors.form || 'Sửa các dòng được đánh dấu rồi thử lại.' }); return; }
    const receipt: Pending = { account: profile.id, contentId, startedAt: new Date().toISOString(), operation: result.operation };
    if (!writeReceipt(receiptKey(profile.id, contentId), JSON.stringify(receipt))) { setBanner({ kind: 'error', title: 'Không thể tạo biên nhận an toàn', text: 'sessionStorage đang bị chặn. Không có POST nào được gửi.' }); return; }
    setPending(receipt); setBusy(true); setBanner(null);
    let postAcknowledged = false;
    try {
      await window.api.post('/admin/listening/exercises', result.operation);
      postAcknowledged = true;
      const nextCollection = await readCollection();
      const matched = findListeningSegmentOperationMatch(nextCollection, result.operation) as Block | null;
      if (account.current !== receipt.account) return;
      if (!matched) throw new Error('POST có response nhưng canonical GET chưa chứa đúng block và segments.');
      clearReceipt(receiptKey(profile.id, contentId)); setPending(null); install(matched, nextCollection); setTargetStatus(status);
      setBanner({
        kind: 'success',
        title: status === 'published' ? 'Đã xuất bản Dictation block' : status === 'archived' ? 'Đã lưu trữ Dictation block' : 'Đã lưu bản nháp',
        text: `Block ${matched.orderNum} · ${matched.segments.length} câu đã được canonical GET xác nhận.`,
      });
    } catch (caught) {
      if (account.current !== receipt.account) return;
      const statusCode = statusOf(caught);
      if (!postAcknowledged && definitive(statusCode)) {
        clearReceipt(receiptKey(profile.id, contentId)); setPending(null);
        if (statusCode === 409) setConflict(true);
        setBanner({ kind: 'error', title: statusCode === 409 ? 'Block đã thay đổi ở nơi khác' : 'Backend từ chối thay đổi', text: statusCode === 409 ? 'Không ghi đè. Tải canonical mới trước khi tiếp tục.' : messageOf(caught) });
      } else setBanner({ kind: 'warning', title: postAcknowledged ? 'POST đã nhận, chưa đọc lại được' : 'Kết quả POST chưa rõ', text: `${messageOf(caught)} Biên nhận được giữ lại; chỉ dùng “Đối chiếu canonical”.` });
    } finally { if (account.current === receipt.account) setBusy(false); }
  };

  const reconcile = async () => {
    if (!pending || busy) return;
    setBusy(true); setBanner(null);
    try {
      const nextCollection = await readCollection();
      const matched = findListeningSegmentOperationMatch(nextCollection, pending.operation) as Block | null;
      if (!matched) throw new Error('Canonical hiện chưa chứa đúng delta của lượt lưu trước.');
      clearReceipt(receiptKey(pending.account, contentId)); setPending(null); install(matched, nextCollection);
      setBanner({ kind: 'success', title: 'Đã xác nhận lưu', text: 'GET canonical khớp đầy đủ; không gửi lại POST.' });
    } catch (caught) { setBanner({ kind: 'error', title: 'Chưa đối chiếu được', text: messageOf(caught) }); }
    finally { setBusy(false); }
  };

  const startNewBlock = () => {
    if (!collection) return;
    const nextOrder = Math.max(0, ...collection.items.map((item) => item.orderNum)) + 1;
    if (nextOrder > 200) { setBanner({ kind: 'error', title: 'Không thể tạo block mới', text: 'Đã đạt giới hạn 200 block cho một content.' }); return; }
    setBaseline(null); setSelectedId(null); setNewOrderNum(nextOrder); setDraft([]);
    setTargetStatus('draft'); setRowErrors({}); setConflict(false);
    window.history.replaceState(null, '', listeningSegmentsHref(contentId));
  };

  const chooseBlock = (id: string) => {
    if (!collection) return;
    if (!id) return;
    if (dirty) { setSwitchTarget(id); setConfirm('switch'); return; }
    install(collection.items.find((item) => item.id === id) || null, collection);
  };

  const applyConfirm = () => {
    if (confirm === 'parse') parseTranscript();
    if (confirm === 'delete' && deleteIndex != null) { setDraft((current) => current.filter((_, index) => index !== deleteIndex)); setRowErrors({}); }
    if (confirm === 'leave') { leaving.current = true; window.location.assign(`/admin/listening/content/${encodeURIComponent(contentId)}`); }
    if (confirm === 'reload') void load();
    if (confirm === 'discard-pending') { clearReceipt(receiptKey(profile.id, contentId)); setPending(null); void load(); }
    if (confirm === 'switch' && collection && switchTarget) install(collection.items.find((item) => item.id === switchTarget) || null, collection);
    if (confirm === 'new-block') startNewBlock();
    setDeleteIndex(null); setSwitchTarget(null); setConfirm(null);
  };

  if (loading) return <main className="alse-shell"><div className="alse-state" role="status">Đang đọc content và Dictation blocks…</div></main>;
  if (loadError || !content || !collection) return <main className="alse-shell"><div className="alc-banner is-error" role="alert"><strong>Không mở được trình phân câu</strong><span>{loadError || 'Không có canonical snapshot hợp lệ.'}</span></div><div className="alse-state-actions"><a className="adm-btn-secondary" href="/admin/listening">Về Listening</a>{contentId && <a className="adm-btn-secondary" href={listeningSegmentsRollbackHref(contentId)}>Mở HTML rollback</a>}<button className="adm-btn-primary" type="button" onClick={() => void load()}>Thử lại</button></div></main>;

  return <main className="alse-shell">
    <nav className="alse-breadcrumb" aria-label="Breadcrumb"><a href="/admin/listening">Listening content</a><span aria-hidden="true">/</span><a href={`/admin/listening/content/${encodeURIComponent(contentId)}`}>{content.title}</a><span aria-hidden="true">/</span><span>Phân câu Dictation</span></nav>
    {banner && <div className={`alc-banner is-${banner.kind}`} role={banner.kind === 'error' ? 'alert' : 'status'}><strong>{banner.title}</strong><span>{banner.text}</span></div>}
    {collection.malformedCount > 0 && <div className="alc-banner is-error" role="alert"><strong>Editor đã khóa vì canonical sai contract</strong><span>Có {collection.malformedCount} Dictation row không đọc được. Không thể tạo hoặc cập nhật block cho tới khi dữ liệu được sửa.</span></div>}
    <header className="alse-hero"><div><p className="alc-eyebrow">Listening · Dictation authoring</p><h1>Phân câu và khóa timestamp</h1><p>Nghe, đặt ranh giới từng câu, rồi lưu đúng một block bằng exact identity và canonical readback.</p><code>{content.id}</code></div><dl><div><dt>Audio</dt><dd>{formatListeningSegmentTime(content.durationSeconds)}</dd></div><div><dt>Content</dt><dd>{STATUS_LABEL[content.status]}</dd></div><div><dt>Block</dt><dd>{baseline ? `#${baseline.orderNum}` : `Mới #${orderNum}`}</dd></div><div><dt>Segments</dt><dd>{draft.length}</dd></div></dl></header>
    {pending && <section className="alse-receipt" aria-labelledby="alse-pending"><div><p className="alc-eyebrow">Pending receipt</p><h2 id="alse-pending">Lượt lưu cần đối chiếu</h2><p>{new Date(pending.startedAt).toLocaleString('vi-VN')} · chỉ GET, không tự POST lại.</p></div><div><button className="adm-btn-primary" type="button" disabled={busy} onClick={() => void reconcile()}>Đối chiếu canonical</button><button className="adm-btn-secondary" type="button" disabled={busy} onClick={() => setConfirm('discard-pending')}>Bỏ biên nhận & tải lại</button></div></section>}
    {conflict && <section className="alse-receipt is-conflict" aria-labelledby="alse-conflict"><div><p className="alc-eyebrow">Version conflict</p><h2 id="alse-conflict">Block đã đổi ở nơi khác</h2><p>Form này không ghi đè canonical. Tải snapshot mới trước khi sửa tiếp.</p></div><button className="adm-btn-primary" type="button" onClick={() => setConfirm('reload')}>Tải canonical mới</button></section>}
    <section className="alse-workspace">
      <div className="alse-main">
        <section className="alse-card" aria-labelledby="alse-audio"><div className="alse-card-head"><div><p className="alc-eyebrow">1 · Nghe nguồn</p><h2 id="alse-audio">Audio canonical</h2></div><button className="adm-btn-secondary" type="button" onClick={fullTrack}>Nghe toàn bài</button></div>{content.audioUrl ? <audio-player ref={(node) => { audioRef.current = node as AudioElement | null; }} src={content.audioUrl} duration-hint={content.durationSeconds} refetch-url={`/admin/listening/content/${encodeURIComponent(contentId)}`} /> : <div className="alc-banner is-error" role="alert"><strong>Không có signed audio URL</strong><span>Không thể đánh dấu timestamp an toàn; thử tải lại content.</span></div>}</section>
        <section className="alse-card" aria-labelledby="alse-source"><div className="alse-card-head"><div><p className="alc-eyebrow">2 · Tạo nháp</p><h2 id="alse-source">Transcript canonical</h2></div><span>{splitListeningTranscript(transcriptText).length} câu dự kiến</span></div><label className="alse-field" htmlFor="alse-transcript"><span>Chỉ đọc · sửa transcript ở Metadata trước khi phân câu</span><textarea id="alse-transcript" value={transcriptText} readOnly aria-readonly="true" /></label><div className="alse-inline-actions"><button className="adm-btn-primary" type="button" disabled={locked || !transcriptText.trim()} onClick={() => draft.length ? setConfirm('parse') : parseTranscript()}>Phân tách & ước tính timestamp</button><small>{content.alignment ? 'Ưu tiên alignment canonical.' : transcriptText.trim() ? 'Không có alignment; dùng tỷ lệ ký tự.' : 'Chưa có transcript; hãy thêm câu thủ công và đánh dấu trên audio.'}</small></div></section>
        <section className="alse-card" aria-labelledby="alse-segments"><div className="alse-card-head"><div><p className="alc-eyebrow">3 · Kiểm tra ranh giới</p><h2 id="alse-segments">Segments</h2></div><button className="adm-btn-secondary" type="button" disabled={locked || draft.length >= MAX_LISTENING_SEGMENTS} onClick={() => { const previous = semantic(draft).at(-1)?.endSec || 0; const end = Math.min(content.durationSeconds, previous + 2); setDraft([...draft, { transcript: '', startText: formatListeningSegmentTime(previous), endText: end > previous ? formatListeningSegmentTime(end) : '' }]); }}>Thêm câu</button></div>{rowErrors.form && <div className="alc-banner is-error" role="alert"><strong>Danh sách chưa hợp lệ</strong><span>{rowErrors.form}</span></div>}<ol className="alse-segments">{draft.map((item, index) => <li key={index} className={rowErrors[index] ? 'is-error' : ''}><div className="alse-segment-index"><strong>#{index + 1}</strong><button type="button" aria-label={`Nghe đoạn câu ${index + 1}`} disabled={locked} onClick={() => preview(index)}>Nghe đoạn</button></div><label><span>Transcript</span><textarea value={item.transcript} disabled={locked} onChange={(event) => updateRow(index, { transcript: event.target.value })} /></label><div className="alse-time-grid"><label><span>Start</span><input inputMode="decimal" value={item.startText} disabled={locked} onChange={(event) => updateRow(index, { startText: event.target.value })} /></label><button type="button" aria-label={`Đánh dấu start câu ${index + 1}`} disabled={locked} onClick={() => mark(index, 'startText')}>Đánh dấu start</button><label><span>End</span><input inputMode="decimal" value={item.endText} disabled={locked} onChange={(event) => updateRow(index, { endText: event.target.value })} /></label><button type="button" aria-label={`Đánh dấu end câu ${index + 1}`} disabled={locked} onClick={() => mark(index, 'endText')}>Đánh dấu end</button></div>{rowErrors[index] && <p className="alse-row-error" role="alert">{rowErrors[index]}</p>}<button className="alse-delete" type="button" aria-label={`Xóa câu ${index + 1}`} disabled={locked} onClick={() => { setDeleteIndex(index); setConfirm('delete'); }}>Xóa câu</button></li>)}</ol>{!draft.length && <div className="alse-empty"><strong>Chưa có segment</strong><span>Dùng transcript nguồn để tạo nháp, hoặc thêm từng câu thủ công.</span></div>}</section>
      </div>
      <aside className="alse-side"><section><p className="alc-eyebrow">Block identity</p><h2>{collection.items.length ? `${collection.items.length} Dictation block` : 'Chưa có block'}</h2>{collection.items.length > 0 && <label className="alse-field" htmlFor="alse-block"><span>Block đang sửa</span><select id="alse-block" value={selectedId || ''} disabled={locked} onChange={(event) => chooseBlock(event.target.value)}>{!baseline && <option value="">Block mới #{orderNum}</option>}{collection.items.map((item) => <option key={item.id} value={item.id}>#{item.orderNum} · {STATUS_LABEL[item.status]} · {item.segments.length} câu</option>)}</select></label>}<button className="adm-btn-secondary" type="button" disabled={locked || Math.max(0, ...collection.items.map((item) => item.orderNum)) >= 200} onClick={() => dirty ? setConfirm('new-block') : startNewBlock()}>Thêm Dictation block</button><dl><div><dt>Exercise ID</dt><dd><code>{baseline?.id || 'Tạo mới khi lưu'}</code></dd></div><div><dt>Order</dt><dd><code>#{orderNum}</code></dd></div><div><dt>Version</dt><dd><code>{baseline?.updatedAt || 'expected_absent'}</code></dd></div><div><dt>Nguồn</dt><dd>{content.sourceType || '—'}</dd></div></dl></section><section><p className="alc-eyebrow">Publication</p><fieldset className="alse-status-options"><legend>Trạng thái đích</legend><label className="alse-radio"><input type="radio" name="status" checked={targetStatus === 'draft'} disabled={locked} onChange={() => setTargetStatus('draft')} /><span><strong>Bản nháp</strong><small>Chưa phục vụ người học.</small></span></label><label className="alse-radio"><input type="radio" name="status" checked={targetStatus === 'published'} disabled={locked} onChange={() => setTargetStatus('published')} /><span><strong>Xuất bản</strong><small>Chỉ khả dụng khi content cha cũng published.</small></span></label><label className="alse-radio"><input type="radio" name="status" checked={targetStatus === 'archived'} disabled={locked} onChange={() => setTargetStatus('archived')} /><span><strong>Lưu trữ</strong><small>Giữ block nhưng không phục vụ người học.</small></span></label></fieldset></section><a className="alc-rollback" href={listeningSegmentsRollbackHref(contentId)}>Mở bản HTML rollback ↗</a></aside>
    </section>
    <footer className="alse-actions"><div><strong>{dirty ? 'Có thay đổi chưa lưu' : 'Đã đồng bộ canonical'}</strong><span>{pending ? 'Đang chờ đối chiếu receipt' : conflict ? 'Phải tải version mới' : `${draft.length} câu · ${STATUS_LABEL[targetStatus]}`}</span></div><div><button className="adm-btn-secondary" type="button" disabled={busy} onClick={() => dirty ? setConfirm('leave') : window.location.assign(`/admin/listening/content/${encodeURIComponent(contentId)}`)}>Về chi tiết</button><button className="adm-btn-secondary" type="button" disabled={!dirty || locked} onClick={() => baseline ? install(baseline, collection) : setDraft([])}>Hoàn tác</button><button className="adm-btn-primary" type="button" disabled={!dirty || locked} onClick={() => void save(targetStatus)}>{busy ? 'Đang đối chiếu…' : targetStatus === 'published' ? 'Lưu & xuất bản' : targetStatus === 'archived' ? 'Lưu bản lưu trữ' : 'Lưu bản nháp'}</button></div></footer>
    <Dialog open={confirm !== null} title={confirm === 'parse' ? 'Thay toàn bộ segments hiện tại?' : confirm === 'delete' ? `Xóa câu #${(deleteIndex ?? 0) + 1}?` : confirm === 'leave' ? 'Rời editor và bỏ thay đổi?' : confirm === 'discard-pending' ? 'Bỏ biên nhận chưa đối chiếu?' : confirm === 'switch' ? 'Chuyển block và bỏ thay đổi?' : confirm === 'new-block' ? 'Tạo block mới và bỏ thay đổi?' : 'Tải canonical mới?'} description={confirm === 'discard-pending' ? 'Chỉ bỏ sau khi đã kiểm tra record; thao tác này không hoàn tác POST có thể đã tới backend.' : 'Thay đổi chưa lưu sẽ không thể khôi phục.'} busy={false} onClose={() => setConfirm(null)} actions={<><button className="adm-btn-secondary" type="button" onClick={() => setConfirm(null)}>Tiếp tục sửa</button><button className="adm-btn-danger" type="button" onClick={applyConfirm}>{confirm === 'delete' ? 'Xóa câu' : confirm === 'parse' ? 'Thay segments' : confirm === 'discard-pending' ? 'Bỏ biên nhận' : confirm === 'reload' ? 'Tải lại' : confirm === 'new-block' ? 'Tạo block mới' : 'Bỏ thay đổi'}</button></>} />
  </main>;
}
