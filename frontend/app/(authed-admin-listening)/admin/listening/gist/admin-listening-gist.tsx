'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useAdminProfile } from '@/components/admin-access-gate';
import { Dialog } from '@/components/admin-directory-ui';
import {
  addListeningGistKeywords, buildListeningGistOperation, findListeningGistOperationMatch,
  listeningGistDraft, listeningGistHref, listeningGistRollbackHref,
  MAX_GIST_KEYWORDS, MAX_GIST_MODEL_ANSWER_LENGTH, MAX_GIST_PROMPT_LENGTH,
  normalizeListeningGistBlocks, normalizeListeningGistContent, normalizePendingListeningGistSave,
} from '@/lib/admin-listening-gist-model.mjs';

type Status = 'draft' | 'published' | 'archived';
type Content = { id: string; title: string; transcript: string; durationSeconds: number; status: Status; audioUrl: string | null; sourceType: string | null };
type Draft = { promptText: string; modelAnswer: string; keywords: string[] };
type Block = Draft & { id: string; contentId: string; orderNum: number; status: Status; updatedAt: string };
type Collection = { items: Block[]; malformedCount: number; duplicateOrders: number[] };
type Pending = { account: string; contentId: string; startedAt: string; operation: Record<string, unknown> };
type Banner = { kind: 'success' | 'warning' | 'error'; title: string; text: string } | null;
type Confirm = 'leave' | 'reload' | 'discard-pending' | 'switch' | 'new-block' | null;

const STATUS_LABEL: Record<Status, string> = { draft: 'Bản nháp', published: 'Đã xuất bản', archived: 'Đã lưu trữ' };
const messageOf = (caught: unknown) => caught instanceof Error ? caught.message : String(caught || 'Lỗi không xác định');
const statusOf = (caught: unknown) => Number((caught as { status?: number; statusCode?: number })?.status || (caught as { statusCode?: number })?.statusCode || 0);
const definitive = (status: number) => [400, 401, 403, 404, 409, 422].includes(status);
const receiptKey = (account: string, contentId: string) => `alge-pending:${account}:${contentId}`;
const readReceipt = (key: string) => { try { return sessionStorage.getItem(key); } catch { return null; } };
const writeReceipt = (key: string, value: string) => { try { sessionStorage.setItem(key, value); return sessionStorage.getItem(key) === value; } catch { return false; } };
const clearReceipt = (key: string) => { try { sessionStorage.removeItem(key); } catch { /* unavailable storage */ } };
const fingerprint = (draft: Draft, status: Status) => JSON.stringify({ promptText: draft.promptText.trim(), modelAnswer: draft.modelAnswer.trim(), keywords: draft.keywords, status });

export function AdminListeningGist({ contentId, requestedExerciseId }: { contentId: string; requestedExerciseId: string | null }) {
  const profile = useAdminProfile();
  const requestOrder = useRef(0);
  const account = useRef(profile.id);
  const leaving = useRef(false);
  const focusId = useRef(requestedExerciseId);
  const [content, setContent] = useState<Content | null>(null);
  const [collection, setCollection] = useState<Collection | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<Block | null>(null);
  const [newOrderNum, setNewOrderNum] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft>(listeningGistDraft(null) as Draft);
  const [targetStatus, setTargetStatus] = useState<Status>('draft');
  const [keywordInput, setKeywordInput] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [conflict, setConflict] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<Banner>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [switchTarget, setSwitchTarget] = useState<string | null>(null);

  const orderNum = baseline?.orderNum || newOrderNum || 1;
  const initial = useMemo(() => listeningGistDraft(baseline) as Draft, [baseline]);
  const dirty = baseline
    ? fingerprint(draft, targetStatus) !== fingerprint(initial, baseline.status)
    : fingerprint(draft, targetStatus) !== fingerprint(listeningGistDraft(null) as Draft, 'draft');
  const locked = busy || Boolean(pending) || conflict
    || Boolean(collection?.duplicateOrders.length) || Boolean(collection?.malformedCount);
  const competingPublished = collection?.items.find((item) => item.status === 'published' && item.id !== baseline?.id) || null;

  const readCollection = useCallback(async () => {
    const raw = await window.api.getWith<unknown>(`/admin/listening/exercises?content_id=${encodeURIComponent(contentId)}&exercise_type=gist`, {}, { noRedirect: true });
    const value = normalizeListeningGistBlocks(raw, contentId) as Collection | null;
    if (!value) throw new Error('Danh sách Gist không đúng contract canonical.');
    return value;
  }, [contentId]);

  const install = useCallback((block: Block | null, nextCollection: Collection) => {
    setCollection(nextCollection); setBaseline(block); setSelectedId(block?.id || null); setNewOrderNum(null);
    focusId.current = block?.id || null;
    setDraft(listeningGistDraft(block) as Draft); setTargetStatus(block?.status || 'draft'); setKeywordInput('');
    setErrors({}); setConflict(false);
    window.history.replaceState(null, '', listeningGistHref(contentId, block?.id || null));
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
      const nextContent = normalizeListeningGistContent(rawContent, contentId) as Content | null;
      if (!nextContent) throw new Error('Nội dung Listening không đúng contract canonical.');
      if (request !== requestOrder.current || account.current !== profile.id) return;
      if (nextCollection.duplicateOrders.length) throw new Error(`Có nhiều Gist block trùng order ${nextCollection.duplicateOrders.join(', ')}; cần sửa dữ liệu trước khi authoring.`);
      if (nextCollection.malformedCount) throw new Error(`Có ${nextCollection.malformedCount} Gist row sai contract. Editor khóa để không ghi đè dữ liệu không đọc được.`);
      const requestedId = focusId.current;
      const block = requestedId
        ? nextCollection.items.find((item) => item.id === requestedId) || null
        : nextCollection.items.find((item) => item.orderNum === 1) || nextCollection.items[0] || null;
      if (requestedId && !block) throw new Error('exercise_id không thuộc content Gist này.');
      setContent(nextContent); install(block, nextCollection);
      const key = receiptKey(profile.id, contentId);
      let restored: Pending | null = null;
      try { restored = normalizePendingListeningGistSave(JSON.parse(readReceipt(key) || 'null'), profile.id, contentId) as Pending | null; } catch { clearReceipt(key); }
      const matched = restored ? findListeningGistOperationMatch(nextCollection, restored.operation) as Block | null : null;
      if (matched) {
        clearReceipt(key); install(matched, nextCollection);
        setBanner({ kind: 'success', title: 'Đã đối chiếu lượt lưu trước', text: 'Canonical GET khớp đầy đủ rubric; hệ thống không gửi lại POST.' });
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

  const addKeywords = () => {
    const result = addListeningGistKeywords(draft.keywords, keywordInput);
    setDraft((current) => ({ ...current, keywords: result.keywords })); setKeywordInput('');
    if (result.rejected.length) setBanner({ kind: 'warning', title: 'Một số từ khóa chưa được thêm', text: 'Từ khóa trùng, quá dài hoặc vượt giới hạn 10 mục. Danh sách không bị cắt âm thầm.' });
    else setBanner(null);
    setErrors((current) => ({ ...current, keywords: '' }));
  };

  const save = async (status: Status) => {
    if (!content || !collection || locked) return;
    if (status === 'published' && competingPublished) {
      const text = `Block #${competingPublished.orderNum} đang phục vụ người học. Chuyển block đó về nháp hoặc lưu trữ trước.`;
      setErrors({ form: text });
      setBanner({ kind: 'error', title: 'Chỉ được có một Gist block published', text });
      return;
    }
    const result = buildListeningGistOperation({ contentId, block: baseline, orderNum, draft, status }) as { ok: boolean; errors: Record<string, string>; operation: Record<string, unknown> | null };
    setErrors(result.errors || {});
    if (!result.ok || !result.operation) { setBanner({ kind: 'error', title: 'Chưa thể lưu', text: 'Sửa các trường được đánh dấu rồi thử lại.' }); return; }
    const receipt: Pending = { account: profile.id, contentId, startedAt: new Date().toISOString(), operation: result.operation };
    if (!writeReceipt(receiptKey(profile.id, contentId), JSON.stringify(receipt))) { setBanner({ kind: 'error', title: 'Không thể tạo biên nhận an toàn', text: 'sessionStorage đang bị chặn. Không có POST nào được gửi.' }); return; }
    setPending(receipt); setBusy(true); setBanner(null);
    let postAcknowledged = false;
    try {
      await window.api.postWith('/admin/listening/exercises', result.operation, {}, { noRedirect: true });
      postAcknowledged = true;
      const nextCollection = await readCollection();
      const matched = findListeningGistOperationMatch(nextCollection, result.operation) as Block | null;
      if (account.current !== receipt.account) return;
      if (!matched) throw new Error('POST có response nhưng canonical GET chưa chứa đúng Gist rubric.');
      clearReceipt(receiptKey(profile.id, contentId)); setPending(null); install(matched, nextCollection);
      setBanner({ kind: 'success', title: status === 'published' ? 'Đã xuất bản Gist block' : status === 'archived' ? 'Đã lưu trữ Gist block' : 'Đã lưu bản nháp', text: `Block ${matched.orderNum} đã được canonical GET xác nhận đầy đủ.` });
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
      const matched = findListeningGistOperationMatch(nextCollection, pending.operation) as Block | null;
      if (!matched) throw new Error('Canonical hiện chưa chứa đúng rubric của lượt lưu trước.');
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
    setBaseline(null); setSelectedId(null); setNewOrderNum(nextOrder); setDraft(listeningGistDraft(null) as Draft);
    setTargetStatus('draft'); setKeywordInput(''); setErrors({}); setConflict(false);
    window.history.replaceState(null, '', listeningGistHref(contentId));
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

  if (loading) return <main className="alge-shell"><div className="alge-state" role="status">Đang đọc content và Gist blocks…</div></main>;
  if (loadError || !content || !collection) return <main className="alge-shell"><div className="alc-banner is-error" role="alert"><strong>Không mở được trình biên tập Gist</strong><span>{loadError || 'Không có canonical snapshot hợp lệ.'}</span></div><div className="alge-state-actions"><a className="adm-btn-secondary" href="/admin/listening">Về Listening</a>{contentId && <a className="adm-btn-secondary" href={listeningGistRollbackHref(contentId)}>Mở HTML rollback</a>}<button className="adm-btn-primary" type="button" onClick={() => void load()}>Thử lại</button></div></main>;

  return <main className="alge-shell">
    <nav className="alge-breadcrumb" aria-label="Breadcrumb"><a href="/admin/listening">Listening content</a><span aria-hidden="true">/</span><a href={`/admin/listening/content/${encodeURIComponent(contentId)}`}>{content.title}</a><span aria-hidden="true">/</span><span>Biên tập Gist</span></nav>
    {banner && <div className={`alc-banner is-${banner.kind}`} role={banner.kind === 'error' ? 'alert' : 'status'}><strong>{banner.title}</strong><span>{banner.text}</span></div>}
    <header className="alge-hero"><div><p className="alc-eyebrow">Listening · Main idea authoring</p><h1>Soạn rubric Gist có thể kiểm chứng</h1><p>Nghe nguồn, viết câu hỏi và ground truth, rồi lưu đúng block bằng exact identity và canonical readback.</p><code>{content.id}</code></div><dl><div><dt>Content</dt><dd>{STATUS_LABEL[content.status]}</dd></div><div><dt>Block</dt><dd>{baseline ? `#${baseline.orderNum}` : `Mới #${orderNum}`}</dd></div><div><dt>Từ khóa</dt><dd>{draft.keywords.length}/{MAX_GIST_KEYWORDS}</dd></div><div><dt>Chấm đạt</dt><dd>≥ 80%</dd></div></dl></header>
    {pending && <section className="alge-receipt" aria-labelledby="alge-pending"><div><p className="alc-eyebrow">Pending receipt</p><h2 id="alge-pending">Lượt lưu cần đối chiếu</h2><p>{new Date(pending.startedAt).toLocaleString('vi-VN')} · chỉ GET, không tự POST lại.</p></div><div><button className="adm-btn-primary" type="button" disabled={busy} onClick={() => void reconcile()}>Đối chiếu canonical</button><button className="adm-btn-secondary" type="button" disabled={busy} onClick={() => setConfirm('discard-pending')}>Bỏ biên nhận & tải lại</button></div></section>}
    {conflict && <section className="alge-receipt is-conflict" aria-labelledby="alge-conflict"><div><p className="alc-eyebrow">Version conflict</p><h2 id="alge-conflict">Block đã đổi ở nơi khác</h2><p>Form này không ghi đè canonical. Tải snapshot mới trước khi sửa tiếp.</p></div><button className="adm-btn-primary" type="button" onClick={() => setConfirm('reload')}>Tải canonical mới</button></section>}
    <section className="alge-workspace">
      <div className="alge-main">
        <section className="alge-card" aria-labelledby="alge-source"><div className="alge-card-head"><div><p className="alc-eyebrow">1 · Đối chiếu nguồn</p><h2 id="alge-source">Audio và transcript canonical</h2></div><span>{Math.round(content.durationSeconds)} giây</span></div>{content.audioUrl ? <audio-player src={content.audioUrl} duration-hint={content.durationSeconds} refetch-url={`/admin/listening/content/${encodeURIComponent(contentId)}`} /> : <div className="alc-banner is-error" role="alert"><strong>Không có signed audio URL</strong><span>Vẫn có thể soạn nháp, nhưng cần nghe kiểm tra trước khi publish.</span></div>}<details className="alge-transcript"><summary>Mở transcript chỉ đọc</summary><div>{content.transcript || 'Content chưa có transcript.'}</div></details></section>
        <section className="alge-card" aria-labelledby="alge-rubric"><div className="alge-card-head"><div><p className="alc-eyebrow">2 · Viết rubric</p><h2 id="alge-rubric">Câu hỏi và ground truth</h2></div><span>AI semantic · Haiku 4.5</span></div>{errors.form && <strong className="alge-field-error" role="alert">{errors.form}</strong>}<label className="alge-field" htmlFor="alge-prompt"><span>Câu hỏi cho học viên</span><textarea id="alge-prompt" value={draft.promptText} maxLength={MAX_GIST_PROMPT_LENGTH} disabled={locked} aria-invalid={Boolean(errors.promptText)} aria-describedby={errors.promptText ? 'alge-prompt-error' : 'alge-prompt-help'} onChange={(event) => { setDraft({ ...draft, promptText: event.target.value }); setErrors({ ...errors, promptText: '', form: '' }); }} /><small id="alge-prompt-help">Một yêu cầu rõ, tập trung vào ý chính thay vì chi tiết nhỏ. {draft.promptText.length}/{MAX_GIST_PROMPT_LENGTH}</small>{errors.promptText && <strong id="alge-prompt-error" className="alge-field-error" role="alert">{errors.promptText}</strong>}</label><label className="alge-field" htmlFor="alge-answer"><span>Đáp án mẫu · ground truth</span><textarea id="alge-answer" className="is-tall" value={draft.modelAnswer} maxLength={MAX_GIST_MODEL_ANSWER_LENGTH} disabled={locked} aria-invalid={Boolean(errors.modelAnswer)} aria-describedby={errors.modelAnswer ? 'alge-answer-error' : 'alge-answer-help'} onChange={(event) => { setDraft({ ...draft, modelAnswer: event.target.value }); setErrors({ ...errors, modelAnswer: '', form: '' }); }} /><small id="alge-answer-help">Viết 2–4 câu nêu đủ chủ thể, luận điểm và kết luận chính. {draft.modelAnswer.length}/{MAX_GIST_MODEL_ANSWER_LENGTH}</small>{errors.modelAnswer && <strong id="alge-answer-error" className="alge-field-error" role="alert">{errors.modelAnswer}</strong>}</label></section>
        <section className="alge-card" aria-labelledby="alge-keywords"><div className="alge-card-head"><div><p className="alc-eyebrow">3 · Neo fallback</p><h2 id="alge-keywords">Từ khóa rubric</h2></div><span>{draft.keywords.length}/{MAX_GIST_KEYWORDS}</span></div><p className="alge-support">Từ khóa chỉ dùng khi AI không khả dụng. Nhập từng cụm ý có nghĩa; không lặp biến thể viết hoa.</p><div className="alge-keyword-entry"><label className="alge-field" htmlFor="alge-keyword"><span>Thêm từ hoặc cụm từ</span><input id="alge-keyword" value={keywordInput} disabled={locked || draft.keywords.length >= MAX_GIST_KEYWORDS} aria-invalid={Boolean(errors.keywords)} aria-describedby={errors.keywords ? 'alge-keyword-error' : 'alge-keyword-help'} onChange={(event) => setKeywordInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); addKeywords(); } }} /></label><button className="adm-btn-secondary" type="button" disabled={locked || !keywordInput.trim() || draft.keywords.length >= MAX_GIST_KEYWORDS} onClick={addKeywords}>Thêm từ khóa</button></div><small id="alge-keyword-help">Có thể dán nhiều mục, ngăn cách bằng dấu phẩy, chấm phẩy hoặc xuống dòng.</small>{errors.keywords && <strong id="alge-keyword-error" className="alge-field-error" role="alert">{errors.keywords}</strong>}<ul className="alge-keywords" aria-label="Từ khóa đã thêm">{draft.keywords.map((keyword, index) => <li key={`${keyword}-${index}`}><span>{keyword}</span><button type="button" aria-label={`Xóa từ khóa ${keyword}`} disabled={locked} onClick={() => setDraft({ ...draft, keywords: draft.keywords.filter((_, itemIndex) => itemIndex !== index) })}>×</button></li>)}</ul>{!draft.keywords.length && <div className="alge-empty"><strong>Chưa có từ khóa fallback</strong><span>Được phép lưu, nhưng khi AI lỗi thì điểm fallback sẽ là 0.</span></div>}
        <div className="alge-score-truth"><strong>Cách chấm thực tế</strong><ol><li>AI so khớp ngữ nghĩa với đáp án mẫu trên thang 0–100.</li><li>Nếu AI lỗi, fallback tính độ phủ từ khóa và bị giới hạn tối đa 60 điểm.</li><li>Học viên đạt khi điểm cuối cùng từ 80 trở lên.</li></ol></div></section>
      </div>
      <aside className="alge-side"><section><p className="alc-eyebrow">Block identity</p><h2>{collection.items.length ? `${collection.items.length} Gist block` : 'Chưa có block'}</h2>{collection.items.length > 0 && <label className="alge-field" htmlFor="alge-block"><span>Block đang sửa</span><select id="alge-block" value={selectedId || ''} disabled={locked} onChange={(event) => chooseBlock(event.target.value)}>{!baseline && <option value="">Block mới #{orderNum}</option>}{collection.items.map((item) => <option key={item.id} value={item.id}>#{item.orderNum} · {STATUS_LABEL[item.status]} · {item.keywords.length} từ khóa</option>)}</select></label>}<button className="adm-btn-secondary" type="button" disabled={locked || Math.max(0, ...collection.items.map((item) => item.orderNum)) >= 200} onClick={() => dirty ? setConfirm('new-block') : startNewBlock()}>Thêm Gist block</button><dl><div><dt>Exercise ID</dt><dd><code>{baseline?.id || 'Tạo mới khi lưu'}</code></dd></div><div><dt>Order</dt><dd><code>#{orderNum}</code></dd></div><div><dt>Version</dt><dd><code>{baseline?.updatedAt || 'expected_absent'}</code></dd></div><div><dt>Nguồn</dt><dd>{content.sourceType || '—'}</dd></div></dl></section><section><p className="alc-eyebrow">Publication</p><fieldset className="alge-status-options"><legend>Trạng thái đích</legend>{(['draft', 'published', 'archived'] as Status[]).map((status) => <label className="alge-radio" key={status}><input type="radio" name="gist-status" checked={targetStatus === status} disabled={locked || (status === 'published' && Boolean(competingPublished))} onChange={() => { setTargetStatus(status); setErrors((current) => ({ ...current, form: '' })); }} /><span><strong>{STATUS_LABEL[status]}</strong><small>{status === 'draft' ? 'Chưa phục vụ người học.' : status === 'published' ? 'Content cha phải published và không có Gist block published khác.' : 'Giữ block nhưng không phục vụ người học.'}</small></span></label>)}</fieldset>{competingPublished && <p className="alge-publication-note">Block #{competingPublished.orderNum} đang phục vụ người học. Mỗi content chỉ có một Gist block published; hãy chuyển block đó về nháp hoặc lưu trữ trước.</p>}{targetStatus === 'published' && content.status !== 'published' && <p className="alge-publication-note">Block có thể được lưu published, nhưng người học chưa thấy cho tới khi content cha cũng published.</p>}</section><a className="alc-rollback" href={listeningGistRollbackHref(contentId)}>Mở bản HTML rollback ↗</a></aside>
    </section>
    <footer className="alge-actions"><div><strong>{dirty ? 'Có thay đổi chưa lưu' : 'Đã đồng bộ canonical'}</strong><span>{pending ? 'Đang chờ đối chiếu receipt' : conflict ? 'Phải tải version mới' : `Block #${orderNum} · ${STATUS_LABEL[targetStatus]}`}</span></div><div><button className="adm-btn-secondary" type="button" disabled={busy} onClick={() => dirty ? setConfirm('leave') : window.location.assign(`/admin/listening/content/${encodeURIComponent(contentId)}`)}>Về chi tiết</button><button className="adm-btn-secondary" type="button" disabled={!dirty || locked} onClick={() => baseline ? install(baseline, collection) : startNewBlock()}>Hoàn tác</button><button className="adm-btn-primary" type="button" disabled={!dirty || locked} onClick={() => void save(targetStatus)}>{busy ? 'Đang đối chiếu…' : targetStatus === 'published' ? 'Lưu & xuất bản' : targetStatus === 'archived' ? 'Lưu bản lưu trữ' : 'Lưu bản nháp'}</button></div></footer>
    <Dialog open={confirm !== null} title={confirm === 'leave' ? 'Rời editor và bỏ thay đổi?' : confirm === 'discard-pending' ? 'Bỏ biên nhận chưa đối chiếu?' : confirm === 'switch' ? 'Chuyển block và bỏ thay đổi?' : confirm === 'new-block' ? 'Tạo block mới và bỏ thay đổi?' : 'Tải canonical mới?'} description={confirm === 'discard-pending' ? 'Chỉ bỏ sau khi đã kiểm tra record; thao tác này không hoàn tác POST có thể đã tới backend.' : 'Thay đổi chưa lưu sẽ không thể khôi phục.'} busy={false} onClose={() => setConfirm(null)} actions={<><button className="adm-btn-secondary" type="button" onClick={() => setConfirm(null)}>Tiếp tục sửa</button><button className="adm-btn-danger" type="button" onClick={applyConfirm}>{confirm === 'discard-pending' ? 'Bỏ biên nhận' : confirm === 'reload' ? 'Tải lại' : confirm === 'new-block' ? 'Tạo block mới' : 'Bỏ thay đổi'}</button></>} />
  </main>;
}
