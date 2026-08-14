'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useAdminProfile } from '@/components/admin-access-gate';
import { Dialog } from '@/components/admin-directory-ui';
import {
  buildListeningTrueFalseOperation, findListeningTrueFalseOperationMatch,
  listeningTrueFalseDraft, listeningTrueFalseHref, listeningTrueFalseRollbackHref,
  MAX_TF_STATEMENTS, MAX_TF_STATEMENT_LENGTH, MIN_TF_STATEMENTS,
  normalizeListeningTrueFalseBlocks, normalizeListeningTrueFalseContent,
  normalizePendingListeningTrueFalseSave,
} from '@/lib/admin-listening-true-false-model.mjs';

type Status = 'draft' | 'published' | 'archived';
type Answer = 'T' | 'F' | 'NG';
type Statement = { key: string; text: string; answer: Answer };
type Content = { id: string; title: string; transcript: string; durationSeconds: number; status: Status; audioUrl: string | null; sourceType: string | null };
type Block = { id: string; contentId: string; orderNum: number; status: Status; updatedAt: string; statements: Statement[] };
type Collection = { items: Block[]; malformedCount: number; duplicateOrders: number[] };
type Pending = { account: string; contentId: string; startedAt: string; operation: Record<string, unknown> };
type Banner = { kind: 'success' | 'warning' | 'error'; title: string; text: string } | null;
type Confirm = 'leave' | 'reload' | 'discard-pending' | 'switch' | 'new-block' | null;

const STATUS_LABEL: Record<Status, string> = { draft: 'Bản nháp', published: 'Đã xuất bản', archived: 'Đã lưu trữ' };
const ANSWER_LABEL: Record<Answer, string> = { T: 'Đúng', F: 'Sai', NG: 'Không có thông tin' };
const ANSWER_HELP: Record<Answer, string> = {
  T: 'Audio xác nhận cùng ý với nhận định.',
  F: 'Audio nêu thông tin trái với nhận định.',
  NG: 'Audio không đủ dữ kiện để xác nhận hay phủ định.',
};
const messageOf = (caught: unknown) => caught instanceof Error ? caught.message : String(caught || 'Lỗi không xác định');
const statusOf = (caught: unknown) => Number((caught as { status?: number; statusCode?: number })?.status || (caught as { statusCode?: number })?.statusCode || 0);
const definitive = (status: number) => [400, 401, 403, 404, 409, 422].includes(status);
const receiptKey = (account: string, contentId: string) => `altf-pending:${account}:${contentId}`;
const readReceipt = (key: string) => { try { return sessionStorage.getItem(key); } catch { return null; } };
const writeReceipt = (key: string, value: string) => { try { sessionStorage.setItem(key, value); return sessionStorage.getItem(key) === value; } catch { return false; } };
const clearReceipt = (key: string) => { try { sessionStorage.removeItem(key); } catch { /* unavailable storage */ } };
const fingerprint = (statements: Statement[], status: Status) => JSON.stringify({ statements: statements.map((item) => ({ text: item.text.trim(), answer: item.answer })), status });
const statementDraft = (block: Block | null) => (listeningTrueFalseDraft(block) as Array<Omit<Statement, 'key'>>)
  .map((statement, index) => ({ ...statement, key: block ? `${block.id}:${index}` : `blank:${index}` }));

export function AdminListeningTrueFalse({ contentId, requestedExerciseId }: { contentId: string; requestedExerciseId: string | null }) {
  const profile = useAdminProfile();
  const requestOrder = useRef(0);
  const account = useRef(profile.id);
  const leaving = useRef(false);
  const focusId = useRef(requestedExerciseId);
  const statementKey = useRef(0);
  const [content, setContent] = useState<Content | null>(null);
  const [collection, setCollection] = useState<Collection | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<Block | null>(null);
  const [newOrderNum, setNewOrderNum] = useState<number | null>(null);
  const [draft, setDraft] = useState<Statement[]>(statementDraft(null));
  const [targetStatus, setTargetStatus] = useState<Status>('draft');
  const [pending, setPending] = useState<Pending | null>(null);
  const [conflict, setConflict] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<Banner>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [switchTarget, setSwitchTarget] = useState<string | null>(null);
  const [reorderNotice, setReorderNotice] = useState('');

  const orderNum = baseline?.orderNum || newOrderNum || 1;
  const initial = useMemo(() => statementDraft(baseline), [baseline]);
  const dirty = baseline
    ? fingerprint(draft, targetStatus) !== fingerprint(initial, baseline.status)
    : fingerprint(draft, targetStatus) !== fingerprint(statementDraft(null), 'draft');
  const locked = busy || Boolean(pending) || conflict
    || Boolean(collection?.duplicateOrders.length) || Boolean(collection?.malformedCount);
  const competingPublished = collection?.items.find((item) => item.status === 'published' && item.id !== baseline?.id) || null;

  const readCollection = useCallback(async () => {
    const raw = await window.api.getWith<unknown>(`/admin/listening/exercises?content_id=${encodeURIComponent(contentId)}&exercise_type=true_false`, {}, { noRedirect: true });
    const value = normalizeListeningTrueFalseBlocks(raw, contentId) as Collection | null;
    if (!value) throw new Error('Danh sách True / False / Not Given không đúng contract canonical.');
    return value;
  }, [contentId]);

  const install = useCallback((block: Block | null, nextCollection: Collection) => {
    setCollection(nextCollection); setBaseline(block); setSelectedId(block?.id || null); setNewOrderNum(null);
    focusId.current = block?.id || null;
    setDraft(statementDraft(block)); setTargetStatus(block?.status || 'draft');
    setErrors({}); setConflict(false);
    window.history.replaceState(null, '', listeningTrueFalseHref(contentId, block?.id || null));
  }, [contentId]);

  const load = useCallback(async () => {
    const request = ++requestOrder.current;
    account.current = profile.id;
    setLoading(true); setLoadError(null); setBanner(null); setPending(null); setConflict(false);
    try {
      const [rawContent, nextCollection] = await Promise.all([
        window.api.getWith<unknown>(`/admin/listening/content/${encodeURIComponent(contentId)}`, {}, { noRedirect: true }),
        readCollection(),
      ]);
      const nextContent = normalizeListeningTrueFalseContent(rawContent, contentId) as Content | null;
      if (!nextContent) throw new Error('Nội dung Listening không đúng contract canonical.');
      if (request !== requestOrder.current || account.current !== profile.id) return;
      if (nextCollection.duplicateOrders.length) throw new Error(`Có nhiều T/F block trùng order ${nextCollection.duplicateOrders.join(', ')}; cần sửa dữ liệu trước khi authoring.`);
      if (nextCollection.malformedCount) throw new Error(`Có ${nextCollection.malformedCount} T/F row sai contract. Editor khóa để không ghi đè dữ liệu không đọc được.`);
      const requestedId = focusId.current;
      const block = requestedId
        ? nextCollection.items.find((item) => item.id === requestedId) || null
        : nextCollection.items.find((item) => item.orderNum === 1) || nextCollection.items[0] || null;
      if (requestedId && !block) throw new Error('exercise_id không thuộc content True / False / Not Given này.');
      setContent(nextContent); install(block, nextCollection);
      const key = receiptKey(profile.id, contentId);
      let restored: Pending | null = null;
      try { restored = normalizePendingListeningTrueFalseSave(JSON.parse(readReceipt(key) || 'null'), profile.id, contentId) as Pending | null; } catch { clearReceipt(key); }
      const matched = restored ? findListeningTrueFalseOperationMatch(nextCollection, restored.operation) as Block | null : null;
      if (matched) {
        clearReceipt(key); install(matched, nextCollection);
        setBanner({ kind: 'success', title: 'Đã đối chiếu lượt lưu trước', text: 'Canonical GET khớp đủ nhận định và ground truth; hệ thống không gửi lại POST.' });
      } else if (restored) {
        setPending(restored);
        setBanner({ kind: 'warning', title: 'Có lượt lưu chưa đối chiếu', text: 'Editor đang khóa. Chỉ GET lại canonical hoặc bỏ biên nhận sau khi kiểm tra; không tự phát lại POST.' });
      }
    } catch (caught) {
      if (request === requestOrder.current) setLoadError(messageOf(caught));
    } finally { if (request === requestOrder.current) setLoading(false); }
  }, [contentId, install, profile.id, readCollection]);

  useEffect(() => { void load(); return () => { requestOrder.current += 1; }; }, [load]);
  useEffect(() => {
    if (!dirty && !pending) return;
    const warn = (event: BeforeUnloadEvent) => { if (leaving.current) return; event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, pending]);

  const updateStatement = (index: number, patch: Partial<Statement>) => {
    setDraft((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
    setErrors((current) => { const next = { ...current }; delete next[`statement-${index}`]; delete next[`answer-${index}`]; delete next.statements; return next; });
  };
  const addStatement = () => {
    if (draft.length >= MAX_TF_STATEMENTS || locked) return;
    setDraft((current) => [...current, { key: `new:${Date.now()}:${statementKey.current++}`, text: '', answer: 'T' }]);
    setErrors((current) => ({ ...current, statements: '' }));
  };
  const removeStatement = (index: number) => {
    if (locked) {
      setBanner({ kind: 'warning', title: 'Editor đang khóa', text: 'Đối chiếu biên nhận hoặc tải canonical mới trước khi xóa nhận định.' });
      return;
    }
    if (draft.length <= MIN_TF_STATEMENTS) {
      setBanner({ kind: 'warning', title: 'Không thể xóa thêm', text: `Một block cần ít nhất ${MIN_TF_STATEMENTS} nhận định.` });
      return;
    }
    setDraft((current) => current.filter((_, itemIndex) => itemIndex !== index));
    setErrors({});
  };
  const moveStatement = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= draft.length || locked) return;
    setDraft((current) => { const next = [...current]; [next[index], next[target]] = [next[target], next[index]]; return next; });
    setReorderNotice(`Đã chuyển nhận định ${index + 1} ${direction < 0 ? 'lên' : 'xuống'} vị trí ${target + 1}.`);
    setErrors({});
  };

  const save = async (status: Status) => {
    if (!content || !collection || locked) return;
    if (status === 'published' && competingPublished) {
      const text = `Block #${competingPublished.orderNum} đang phục vụ người học. Chuyển block đó về nháp hoặc lưu trữ trước.`;
      setErrors({ form: text });
      setBanner({ kind: 'error', title: 'Chỉ được có một T/F block published', text });
      return;
    }
    const result = buildListeningTrueFalseOperation({ contentId, block: baseline, orderNum, draft, status }) as { ok: boolean; errors: Record<string, string>; operation: Record<string, unknown> | null };
    setErrors(result.errors || {});
    if (!result.ok || !result.operation) { setBanner({ kind: 'error', title: 'Chưa thể lưu', text: 'Sửa các nhận định được đánh dấu rồi thử lại.' }); return; }
    const receipt: Pending = { account: profile.id, contentId, startedAt: new Date().toISOString(), operation: result.operation };
    if (!writeReceipt(receiptKey(profile.id, contentId), JSON.stringify(receipt))) { setBanner({ kind: 'error', title: 'Không thể tạo biên nhận an toàn', text: 'sessionStorage đang bị chặn. Không có POST nào được gửi.' }); return; }
    setPending(receipt); setBusy(true); setBanner(null);
    let postAcknowledged = false;
    try {
      await window.api.postWith('/admin/listening/exercises', result.operation, {}, { noRedirect: true });
      postAcknowledged = true;
      const nextCollection = await readCollection();
      const matched = findListeningTrueFalseOperationMatch(nextCollection, result.operation) as Block | null;
      if (account.current !== receipt.account) return;
      if (!matched) throw new Error('POST có response nhưng canonical GET chưa chứa đúng nhận định và ground truth.');
      clearReceipt(receiptKey(profile.id, contentId)); setPending(null); install(matched, nextCollection);
      setBanner({ kind: 'success', title: status === 'published' ? 'Đã xuất bản T/F block' : status === 'archived' ? 'Đã lưu trữ T/F block' : 'Đã lưu bản nháp', text: `Block ${matched.orderNum} đã được canonical GET xác nhận đầy đủ.` });
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
      const matched = findListeningTrueFalseOperationMatch(nextCollection, pending.operation) as Block | null;
      if (!matched) throw new Error('Canonical hiện chưa chứa đúng nhận định của lượt lưu trước.');
      clearReceipt(receiptKey(pending.account, contentId)); setPending(null); install(matched, nextCollection);
      setBanner({ kind: 'success', title: 'Đã xác nhận lưu', text: 'GET canonical khớp đầy đủ; không gửi lại POST.' });
    } catch (caught) { setBanner({ kind: 'error', title: 'Chưa đối chiếu được', text: messageOf(caught) }); }
    finally { setBusy(false); }
  };

  const startNewBlock = () => {
    if (!collection) return;
    const nextOrder = Math.max(0, ...collection.items.map((item) => item.orderNum)) + 1;
    if (nextOrder > 200) { setBanner({ kind: 'error', title: 'Không thể tạo block mới', text: 'Đã đạt giới hạn 200 block cho một content.' }); return; }
    focusId.current = null;
    setBaseline(null); setSelectedId(null); setNewOrderNum(nextOrder); setDraft(statementDraft(null));
    setTargetStatus('draft'); setErrors({}); setConflict(false);
    window.history.replaceState(null, '', listeningTrueFalseHref(contentId));
  };
  const chooseBlock = (id: string) => {
    if (!collection || !id) return;
    if (dirty) { setSwitchTarget(id); setConfirm('switch'); return; }
    install(collection.items.find((item) => item.id === id) || null, collection);
  };
  const applyConfirm = () => {
    if (confirm === 'leave') { leaving.current = true; window.location.assign(`/admin/listening/content/${encodeURIComponent(contentId)}`); }
    if (confirm === 'reload') void load();
    if (confirm === 'discard-pending') { clearReceipt(receiptKey(profile.id, contentId)); setPending(null); void load(); }
    if (confirm === 'switch' && collection && switchTarget) install(collection.items.find((item) => item.id === switchTarget) || null, collection);
    if (confirm === 'new-block') startNewBlock();
    setSwitchTarget(null); setConfirm(null);
  };

  if (loading) return <main className="altf-shell"><div className="altf-state" role="status">Đang đọc content và True / False blocks…</div></main>;
  if (loadError || !content || !collection) return <main className="altf-shell"><div className="alc-banner is-error" role="alert"><strong>Không mở được trình biên tập True / False</strong><span>{loadError || 'Không có canonical snapshot hợp lệ.'}</span></div><div className="altf-state-actions"><a className="adm-btn-secondary" href="/admin/listening">Về Listening</a>{contentId && <a className="adm-btn-secondary" href={listeningTrueFalseRollbackHref(contentId)}>Mở HTML rollback</a>}<button className="adm-btn-primary" type="button" onClick={() => void load()}>Thử lại</button></div></main>;

  return <main className="altf-shell">
    <nav className="altf-breadcrumb" aria-label="Breadcrumb"><a href="/admin/listening">Listening content</a><span aria-hidden="true">/</span><a href={`/admin/listening/content/${encodeURIComponent(contentId)}`}>{content.title}</a><span aria-hidden="true">/</span><span>Biên tập True / False / Not Given</span></nav>
    {banner && <div className={`alc-banner is-${banner.kind}`} role={banner.kind === 'error' ? 'alert' : 'status'}><strong>{banner.title}</strong><span>{banner.text}</span></div>}
    <header className="altf-hero"><div><p className="alc-eyebrow">Listening · Evidence authoring</p><h1>Soạn nhận định T / F / NG theo bằng chứng</h1><p>Đối chiếu từng nhận định với audio và transcript, gắn ground truth rõ nghĩa rồi lưu đúng block bằng exact identity.</p><code>{content.id}</code></div><dl><div><dt>Content</dt><dd>{STATUS_LABEL[content.status]}</dd></div><div><dt>Block</dt><dd>{baseline ? `#${baseline.orderNum}` : `Mới #${orderNum}`}</dd></div><div><dt>Nhận định</dt><dd>{draft.length}/{MAX_TF_STATEMENTS}</dd></div><div><dt>Điều kiện đạt</dt><dd>Đúng 100%</dd></div></dl></header>
    {pending && <section className="altf-receipt" aria-labelledby="altf-pending"><div><p className="alc-eyebrow">Pending receipt</p><h2 id="altf-pending">Lượt lưu cần đối chiếu</h2><p>{new Date(pending.startedAt).toLocaleString('vi-VN')} · chỉ GET, không tự POST lại.</p></div><div><button className="adm-btn-primary" type="button" disabled={busy} onClick={() => void reconcile()}>Đối chiếu canonical</button><button className="adm-btn-secondary" type="button" disabled={busy} onClick={() => setConfirm('discard-pending')}>Bỏ biên nhận & tải lại</button></div></section>}
    {conflict && <section className="altf-receipt is-conflict" aria-labelledby="altf-conflict"><div><p className="alc-eyebrow">Version conflict</p><h2 id="altf-conflict">Block đã đổi ở nơi khác</h2><p>Form này không ghi đè canonical. Tải snapshot mới trước khi sửa tiếp.</p></div><button className="adm-btn-primary" type="button" onClick={() => setConfirm('reload')}>Tải canonical mới</button></section>}
    <section className="altf-workspace">
      <div className="altf-main">
        <section className="altf-card" aria-labelledby="altf-source"><div className="altf-card-head"><div><p className="alc-eyebrow">1 · Đối chiếu nguồn</p><h2 id="altf-source">Audio và transcript canonical</h2></div><span>{Math.round(content.durationSeconds)} giây</span></div>{content.audioUrl ? <audio-player src={content.audioUrl} duration-hint={content.durationSeconds} refetch-url={`/admin/listening/content/${encodeURIComponent(contentId)}`} /> : <div className="alc-banner is-error" role="alert"><strong>Không có signed audio URL</strong><span>Vẫn có thể soạn nháp, nhưng cần nghe kiểm tra trước khi publish.</span></div>}<details className="altf-transcript"><summary>Mở transcript chỉ đọc</summary><div>{content.transcript || 'Content chưa có transcript.'}</div></details></section>
        <section className="altf-card" aria-labelledby="altf-statements"><div className="altf-card-head"><div><p className="alc-eyebrow">2 · Viết nhận định</p><h2 id="altf-statements">Ground truth theo từng câu</h2></div><span>{MIN_TF_STATEMENTS}–{MAX_TF_STATEMENTS} câu</span></div><p className="altf-support">Viết câu có thể phán định trực tiếp từ nguồn. “Sai” phải có thông tin trái ngược trong audio; thiếu thông tin phải chọn “Không có”.</p>{errors.form && <strong className="altf-field-error" role="alert">{errors.form}</strong>}{errors.statements && <strong className="altf-field-error" role="alert">{errors.statements}</strong>}<span className="sr-only" role="status" aria-live="polite">{reorderNotice}</span><ol className="altf-statements">{draft.map((statement, index) => <li key={statement.key} className={errors[`statement-${index}`] || errors[`answer-${index}`] ? 'has-error' : ''}><div className="altf-statement-head"><span>Câu {index + 1}</span><div><button type="button" className="adm-btn-secondary" aria-label={`Đưa câu ${index + 1} lên`} aria-disabled={index === 0} disabled={locked} onClick={() => moveStatement(index, -1)}>↑</button><button type="button" className="adm-btn-secondary" aria-label={`Đưa câu ${index + 1} xuống`} aria-disabled={index === draft.length - 1} disabled={locked} onClick={() => moveStatement(index, 1)}>↓</button><button type="button" className="adm-btn-danger" aria-label={`Xóa câu ${index + 1}`} disabled={locked || draft.length <= MIN_TF_STATEMENTS} onClick={() => removeStatement(index)}>Xóa</button></div></div><label className="altf-field" htmlFor={`altf-text-${index}`}><span>Nhận định học viên sẽ thấy</span><textarea id={`altf-text-${index}`} value={statement.text} maxLength={MAX_TF_STATEMENT_LENGTH} disabled={locked} aria-invalid={Boolean(errors[`statement-${index}`])} aria-describedby={`altf-help-${index}${errors[`statement-${index}`] ? ` altf-error-${index}` : ''}`} onChange={(event) => updateStatement(index, { text: event.target.value })} /><small id={`altf-help-${index}`}>Một ý duy nhất, không gài bằng diễn đạt mơ hồ. {statement.text.length}/{MAX_TF_STATEMENT_LENGTH}</small>{errors[`statement-${index}`] && <strong id={`altf-error-${index}`} className="altf-field-error" role="alert">{errors[`statement-${index}`]}</strong>}</label><fieldset className="altf-answer-options" aria-describedby={errors[`answer-${index}`] ? `altf-answer-error-${index}` : undefined}><legend>Ground truth</legend>{(['T', 'F', 'NG'] as Answer[]).map((answer) => <label key={answer} className={`altf-answer is-${answer.toLowerCase()}`}><input type="radio" name={`answer-${index}`} value={answer} checked={statement.answer === answer} disabled={locked} onChange={() => updateStatement(index, { answer })} /><span><strong>{answer} · {ANSWER_LABEL[answer]}</strong><small>{ANSWER_HELP[answer]}</small></span></label>)}{errors[`answer-${index}`] && <strong id={`altf-answer-error-${index}`} className="altf-field-error" role="alert">{errors[`answer-${index}`]}</strong>}</fieldset></li>)}</ol><button className="adm-btn-secondary altf-add" type="button" disabled={locked || draft.length >= MAX_TF_STATEMENTS} onClick={addStatement}>+ Thêm nhận định</button><div className="altf-score-truth"><strong>Cách chấm thực tế</strong><ol><li>Mỗi câu được so khớp chính xác với T, F hoặc NG; không có chấm một phần trong từng câu.</li><li>Điểm toàn block = số câu đúng chia tổng số câu; câu bỏ trống tính sai.</li><li>Backend chỉ đánh dấu hoàn thành đúng khi học viên trả lời đúng 100% nhận định.</li></ol></div></section>
      </div>
      <aside className="altf-side"><section><p className="alc-eyebrow">Block identity</p><h2>{collection.items.length ? `${collection.items.length} T/F block` : 'Chưa có block'}</h2>{collection.items.length > 0 && <label className="altf-field" htmlFor="altf-block"><span>Block đang sửa</span><select id="altf-block" value={selectedId || ''} disabled={locked} onChange={(event) => chooseBlock(event.target.value)}>{!baseline && <option value="">Block mới #{orderNum}</option>}{collection.items.map((item) => <option key={item.id} value={item.id}>#{item.orderNum} · {STATUS_LABEL[item.status]} · {item.statements.length} câu</option>)}</select></label>}<button className="adm-btn-secondary" type="button" disabled={locked || Math.max(0, ...collection.items.map((item) => item.orderNum)) >= 200} onClick={() => dirty ? setConfirm('new-block') : startNewBlock()}>Thêm T/F block</button><dl><div><dt>Exercise ID</dt><dd><code>{baseline?.id || 'Tạo mới khi lưu'}</code></dd></div><div><dt>Order</dt><dd><code>#{orderNum}</code></dd></div><div><dt>Version</dt><dd><code>{baseline?.updatedAt || 'expected_absent'}</code></dd></div><div><dt>Nguồn</dt><dd>{content.sourceType || '—'}</dd></div></dl></section><section><p className="alc-eyebrow">Publication</p><fieldset className="altf-status-options"><legend>Trạng thái đích</legend>{(['draft', 'published', 'archived'] as Status[]).map((status) => <label className="altf-radio" key={status}><input type="radio" name="tf-status" checked={targetStatus === status} disabled={locked || (status === 'published' && Boolean(competingPublished))} onChange={() => { setTargetStatus(status); setErrors((current) => ({ ...current, form: '' })); }} /><span><strong>{STATUS_LABEL[status]}</strong><small>{status === 'draft' ? 'Chưa phục vụ người học.' : status === 'published' ? 'Content cha phải published và không có T/F block published khác.' : 'Giữ block nhưng không phục vụ người học.'}</small></span></label>)}</fieldset>{competingPublished && <p className="altf-publication-note">Block #{competingPublished.orderNum} đang phục vụ người học. Mỗi content chỉ có một T/F block published; hãy chuyển block đó về nháp hoặc lưu trữ trước.</p>}{targetStatus === 'published' && content.status !== 'published' && <p className="altf-publication-note">Block có thể được lưu published, nhưng người học chưa thấy cho tới khi content cha cũng published.</p>}</section><a className="alc-rollback" href={listeningTrueFalseRollbackHref(contentId)}>Mở bản HTML rollback ↗</a></aside>
    </section>
    <footer className="altf-actions"><div><strong>{dirty ? 'Có thay đổi chưa lưu' : 'Đã đồng bộ canonical'}</strong><span>{pending ? 'Đang chờ đối chiếu receipt' : conflict ? 'Phải tải version mới' : `Block #${orderNum} · ${STATUS_LABEL[targetStatus]}`}</span></div><div><button className="adm-btn-secondary" type="button" disabled={busy} onClick={() => dirty ? setConfirm('leave') : window.location.assign(`/admin/listening/content/${encodeURIComponent(contentId)}`)}>Về chi tiết</button><button className="adm-btn-secondary" type="button" disabled={!dirty || locked} onClick={() => baseline ? install(baseline, collection) : startNewBlock()}>Hoàn tác</button><button className="adm-btn-primary" type="button" disabled={!dirty || locked} onClick={() => void save(targetStatus)}>{busy ? 'Đang đối chiếu…' : targetStatus === 'published' ? 'Lưu & xuất bản' : targetStatus === 'archived' ? 'Lưu bản lưu trữ' : 'Lưu bản nháp'}</button></div></footer>
    <Dialog open={confirm !== null} title={confirm === 'leave' ? 'Rời editor và bỏ thay đổi?' : confirm === 'discard-pending' ? 'Bỏ biên nhận chưa đối chiếu?' : confirm === 'switch' ? 'Chuyển block và bỏ thay đổi?' : confirm === 'new-block' ? 'Tạo block mới và bỏ thay đổi?' : 'Tải canonical mới?'} description={confirm === 'discard-pending' ? 'Chỉ bỏ sau khi đã kiểm tra record; thao tác này không hoàn tác POST có thể đã tới backend.' : 'Thay đổi chưa lưu sẽ không thể khôi phục.'} busy={false} onClose={() => setConfirm(null)} actions={<><button className="adm-btn-secondary" type="button" onClick={() => setConfirm(null)}>Tiếp tục sửa</button><button className="adm-btn-danger" type="button" onClick={applyConfirm}>{confirm === 'discard-pending' ? 'Bỏ biên nhận' : confirm === 'reload' ? 'Tải lại' : confirm === 'new-block' ? 'Tạo block mới' : 'Bỏ thay đổi'}</button></>} />
  </main>;
}
