'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useAdminProfile } from '@/components/admin-access-gate';
import { Dialog } from '@/components/admin-directory-ui';
import {
  buildListeningMcqOperation,
  findListeningMcqOperationMatch,
  listeningMcqDraft,
  listeningMcqHref,
  listeningMcqRollbackHref,
  MAX_MCQ_OPTION_LENGTH,
  MAX_MCQ_QUESTIONS,
  MAX_MCQ_STEM_LENGTH,
  MIN_MCQ_QUESTIONS,
  nextListeningMcqOrder,
  normalizeListeningMcqBlocks,
  normalizeListeningMcqContent,
  normalizePendingListeningMcqSave,
} from '@/lib/admin-listening-mcq-model.mjs';

type Status = 'draft' | 'published' | 'archived';
type Question = { key: string; stem: string; options: string[]; answerIdx: number | null };
type Content = { id: string; title: string; transcript: string; durationSeconds: number; status: Status; audioUrl: string | null; sourceType: string | null };
type Block = { id: string; contentId: string; orderNum: number; status: Status; updatedAt: string; questions: Array<{ stem: string; options: string[]; answerIdx: number }> };
type Collection = { items: Block[]; malformedCount: number; importedCount: number; importedIds: string[]; importedOrders: number[]; importedPublishedOrders: number[]; duplicateOrders: number[] };
type Pending = { account: string; contentId: string; startedAt: string; operation: Record<string, unknown> };
type Banner = { kind: 'success' | 'warning' | 'error'; title: string; text: string } | null;
type Confirm = 'leave' | 'reload' | 'discard-pending' | 'switch' | 'new-block' | null;

const STATUS_LABEL: Record<Status, string> = { draft: 'Bản nháp', published: 'Đã xuất bản', archived: 'Đã lưu trữ' };
const LETTERS = ['A', 'B', 'C', 'D'];
const messageOf = (caught: unknown) => caught instanceof Error ? caught.message : String(caught || 'Lỗi không xác định');
const statusOf = (caught: unknown) => Number((caught as { status?: number; statusCode?: number })?.status || (caught as { statusCode?: number })?.statusCode || 0);
const definitive = (status: number) => [400, 401, 403, 404, 409, 422].includes(status);
const receiptKey = (account: string, contentId: string) => `almc-pending:${account}:${contentId}`;
const readReceipt = (key: string) => { try { return sessionStorage.getItem(key); } catch { return null; } };
const writeReceipt = (key: string, value: string) => { try { sessionStorage.setItem(key, value); return sessionStorage.getItem(key) === value; } catch { return false; } };
const clearReceipt = (key: string) => { try { sessionStorage.removeItem(key); } catch { /* unavailable storage */ } };
const fingerprint = (questions: Question[], status: Status) => JSON.stringify({
  questions: questions.map((question) => ({
    stem: question.stem.trim(),
    options: question.options.map((option) => option.trim()),
    answerIdx: question.answerIdx,
  })),
  status,
});
const questionDraft = (block: Block | null): Question[] => (listeningMcqDraft(block) as Array<Omit<Question, 'key'>>)
  .map((question, index) => ({ ...question, options: [...question.options], key: block ? `${block.id}:${index}` : `blank:${index}` }));

export function AdminListeningMcq({ contentId, requestedExerciseId }: { contentId: string; requestedExerciseId: string | null }) {
  const profile = useAdminProfile();
  const requestOrder = useRef(0);
  const account = useRef(profile.id);
  const leaving = useRef(false);
  const focusId = useRef(requestedExerciseId);
  const questionKey = useRef(0);
  const [content, setContent] = useState<Content | null>(null);
  const [collection, setCollection] = useState<Collection | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<Block | null>(null);
  const [newOrderNum, setNewOrderNum] = useState<number | null>(null);
  const [draft, setDraft] = useState<Question[]>(questionDraft(null));
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
  const initial = useMemo(() => questionDraft(baseline), [baseline]);
  const dirty = baseline
    ? fingerprint(draft, targetStatus) !== fingerprint(initial, baseline.status)
    : fingerprint(draft, targetStatus) !== fingerprint(questionDraft(null), 'draft');
  const locked = busy || Boolean(pending) || conflict
    || Boolean(collection?.duplicateOrders.length) || Boolean(collection?.malformedCount);
  const competingPublished = collection?.items.find((item) => item.status === 'published' && item.id !== baseline?.id) || null;
  const competingPublishedOrder = competingPublished?.orderNum || collection?.importedPublishedOrders[0] || null;

  const readCollection = useCallback(async () => {
    const raw = await window.api.getWith<unknown>(`/admin/listening/exercises?content_id=${encodeURIComponent(contentId)}&exercise_type=mcq`, {}, { noRedirect: true });
    const value = normalizeListeningMcqBlocks(raw, contentId) as Collection | null;
    if (!value) throw new Error('Danh sách Multiple Choice không đúng contract canonical.');
    return value;
  }, [contentId]);

  const install = useCallback((block: Block | null, nextCollection: Collection) => {
    setCollection(nextCollection);
    setBaseline(block);
    setSelectedId(block?.id || null);
    setNewOrderNum(block ? null : nextListeningMcqOrder(nextCollection));
    focusId.current = block?.id || null;
    setDraft(questionDraft(block));
    setTargetStatus(block?.status || 'draft');
    setErrors({});
    setConflict(false);
    window.history.replaceState(null, '', listeningMcqHref(contentId, block?.id || null));
  }, [contentId]);

  const load = useCallback(async () => {
    const request = ++requestOrder.current;
    account.current = profile.id;
    setLoading(true);
    setLoadError(null);
    setBanner(null);
    setPending(null);
    setConflict(false);
    try {
      const [rawContent, nextCollection] = await Promise.all([
        window.api.getWith<unknown>(`/admin/listening/content/${encodeURIComponent(contentId)}`, {}, { noRedirect: true }),
        readCollection(),
      ]);
      const nextContent = normalizeListeningMcqContent(rawContent, contentId) as Content | null;
      if (!nextContent) throw new Error('Nội dung Listening không đúng contract canonical.');
      if (request !== requestOrder.current || account.current !== profile.id) return;
      setContent(nextContent);
      setCollection(nextCollection);
      if (nextCollection.duplicateOrders.length) throw new Error(`Có nhiều MCQ block trùng order ${nextCollection.duplicateOrders.join(', ')}; cần sửa dữ liệu trước khi authoring.`);
      if (nextCollection.malformedCount) throw new Error(`Có ${nextCollection.malformedCount} MCQ row sai contract. Editor khóa để không ghi đè dữ liệu không đọc được.`);
      const requestedId = focusId.current;
      const requestedImporter = Boolean(requestedId && nextCollection.importedIds.includes(requestedId));
      const block = requestedId && !requestedImporter
        ? nextCollection.items.find((item) => item.id === requestedId) || null
        : nextCollection.items.find((item) => item.orderNum === 1) || nextCollection.items[0] || null;
      if (requestedId && !block && !requestedImporter) throw new Error('exercise_id không thuộc content Multiple Choice này.');
      install(block, nextCollection);
      if (requestedImporter) setBanner({ kind: 'warning', title: 'Block thuộc kho đề', text: 'Deep-link này trỏ tới MCQ do importer quản lý. Editor đã mở block standalone gần nhất và không ghi đè payload kho đề.' });
      const key = receiptKey(profile.id, contentId);
      let restored: Pending | null = null;
      try { restored = normalizePendingListeningMcqSave(JSON.parse(readReceipt(key) || 'null'), profile.id, contentId) as Pending | null; } catch { clearReceipt(key); }
      const matched = restored ? findListeningMcqOperationMatch(nextCollection, restored.operation) as Block | null : null;
      if (matched) {
        clearReceipt(key);
        install(matched, nextCollection);
        setBanner({ kind: 'success', title: 'Đã đối chiếu lượt lưu trước', text: 'Canonical GET khớp đủ câu hỏi, lựa chọn và answer key; hệ thống không gửi lại POST.' });
      } else if (restored) {
        setPending(restored);
        setBanner({ kind: 'warning', title: 'Có lượt lưu chưa đối chiếu', text: 'Editor đang khóa. Chỉ GET lại canonical hoặc bỏ biên nhận sau khi kiểm tra; không tự phát lại POST.' });
      }
    } catch (caught) {
      if (request === requestOrder.current) setLoadError(messageOf(caught));
    } finally {
      if (request === requestOrder.current) setLoading(false);
    }
  }, [contentId, install, profile.id, readCollection]);

  useEffect(() => { void load(); return () => { requestOrder.current += 1; }; }, [load]);
  useEffect(() => {
    if (!dirty && !pending) return;
    const warn = (event: BeforeUnloadEvent) => { if (leaving.current) return; event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, pending]);

  const clearOwnedError = (key: string) => {
    setErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  };
  const updateQuestion = (index: number, patch: Partial<Question>) => {
    setDraft((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
    if (Object.hasOwn(patch, 'stem')) clearOwnedError(`question-${index}`);
    if (Object.hasOwn(patch, 'answerIdx')) clearOwnedError(`answer-${index}`);
  };
  const updateOption = (index: number, optionIndex: number, value: string) => {
    setDraft((current) => current.map((item, itemIndex) => {
      if (itemIndex !== index) return item;
      const options = [...item.options];
      options[optionIndex] = value;
      return { ...item, options };
    }));
    clearOwnedError(`option-${index}-${optionIndex}`);
  };
  const addQuestion = () => {
    if (draft.length >= MAX_MCQ_QUESTIONS || locked) return;
    setDraft((current) => [...current, {
      key: `new:${Date.now()}:${questionKey.current++}`,
      stem: '', options: ['', '', '', ''], answerIdx: null,
    }]);
    setErrors((current) => ({ ...current, questions: '' }));
  };
  const removeQuestion = (index: number) => {
    if (locked) {
      setBanner({ kind: 'warning', title: 'Editor đang khóa', text: 'Đối chiếu biên nhận hoặc tải canonical mới trước khi xóa câu hỏi.' });
      return;
    }
    if (draft.length <= MIN_MCQ_QUESTIONS) {
      setBanner({ kind: 'warning', title: 'Không thể xóa thêm', text: `Một block cần ít nhất ${MIN_MCQ_QUESTIONS} câu hỏi.` });
      return;
    }
    setDraft((current) => current.filter((_, itemIndex) => itemIndex !== index));
    setErrors({});
  };
  const moveQuestion = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= draft.length || locked) return;
    setDraft((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setReorderNotice(`Đã chuyển câu ${index + 1} ${direction < 0 ? 'lên' : 'xuống'} vị trí ${target + 1}.`);
    setErrors({});
  };

  const save = async (status: Status) => {
    if (!content || !collection || locked) return;
    if (status === 'published' && competingPublishedOrder) {
      const text = `Block #${competingPublishedOrder} đang phục vụ người học. Chuyển block đó về nháp hoặc lưu trữ trước.`;
      setErrors({ form: text });
      setBanner({ kind: 'error', title: 'Chỉ được có một MCQ block published', text });
      return;
    }
    const result = buildListeningMcqOperation({ contentId, block: baseline, orderNum, draft, status }) as {
      ok: boolean; errors: Record<string, string>; operation: Record<string, unknown> | null;
    };
    setErrors(result.errors || {});
    if (!result.ok || !result.operation) {
      setBanner({ kind: 'error', title: 'Chưa thể lưu', text: 'Sửa các câu hỏi và lựa chọn được đánh dấu rồi thử lại.' });
      return;
    }
    const receipt: Pending = { account: profile.id, contentId, startedAt: new Date().toISOString(), operation: result.operation };
    if (!writeReceipt(receiptKey(profile.id, contentId), JSON.stringify(receipt))) {
      setBanner({ kind: 'error', title: 'Không thể tạo biên nhận an toàn', text: 'sessionStorage đang bị chặn. Không có POST nào được gửi.' });
      return;
    }
    setPending(receipt);
    setBusy(true);
    setBanner(null);
    let postAcknowledged = false;
    try {
      await window.api.postWith('/admin/listening/exercises', result.operation, {}, { noRedirect: true });
      postAcknowledged = true;
      const nextCollection = await readCollection();
      const matched = findListeningMcqOperationMatch(nextCollection, result.operation) as Block | null;
      if (account.current !== receipt.account) return;
      if (!matched) throw new Error('POST có response nhưng canonical GET chưa chứa đúng câu hỏi, lựa chọn và answer key.');
      clearReceipt(receiptKey(profile.id, contentId));
      setPending(null);
      install(matched, nextCollection);
      setBanner({
        kind: 'success',
        title: status === 'published' ? 'Đã xuất bản MCQ block' : status === 'archived' ? 'Đã lưu trữ MCQ block' : 'Đã lưu bản nháp',
        text: `Block ${matched.orderNum} đã được canonical GET xác nhận đầy đủ.`,
      });
    } catch (caught) {
      if (account.current !== receipt.account) return;
      const statusCode = statusOf(caught);
      if (!postAcknowledged && definitive(statusCode)) {
        clearReceipt(receiptKey(profile.id, contentId));
        setPending(null);
        const detail = messageOf(caught);
        const publicationConflict = statusCode === 409 && /published[\s\S]*block|block[\s\S]*published/i.test(detail);
        const versionConflict = statusCode === 409 && !publicationConflict;
        if (versionConflict) setConflict(true);
        setBanner({
          kind: 'error',
          title: statusCode === 409 ? 'Canonical từ chối thay đổi xung đột' : 'Backend từ chối thay đổi',
          text: detail,
        });
      } else {
        setBanner({
          kind: 'warning',
          title: postAcknowledged ? 'POST đã nhận, chưa đọc lại được' : 'Kết quả POST chưa rõ',
          text: `${messageOf(caught)} Biên nhận được giữ lại; chỉ dùng “Đối chiếu canonical”.`,
        });
      }
    } finally {
      if (account.current === receipt.account) setBusy(false);
    }
  };

  const reconcile = async () => {
    if (!pending || busy) return;
    setBusy(true);
    setBanner(null);
    try {
      const nextCollection = await readCollection();
      const matched = findListeningMcqOperationMatch(nextCollection, pending.operation) as Block | null;
      if (!matched) throw new Error('Canonical hiện chưa chứa đúng câu hỏi của lượt lưu trước.');
      clearReceipt(receiptKey(pending.account, contentId));
      setPending(null);
      install(matched, nextCollection);
      setBanner({ kind: 'success', title: 'Đã xác nhận lưu', text: 'GET canonical khớp đầy đủ; không gửi lại POST.' });
    } catch (caught) {
      setBanner({ kind: 'error', title: 'Chưa đối chiếu được', text: messageOf(caught) });
    } finally {
      setBusy(false);
    }
  };

  const startNewBlock = () => {
    if (!collection) return;
    const nextOrder = nextListeningMcqOrder(collection);
    if (nextOrder == null) {
      setBanner({ kind: 'error', title: 'Không thể tạo block mới', text: 'Đã đạt giới hạn 200 block cho một content.' });
      return;
    }
    focusId.current = null;
    setBaseline(null);
    setSelectedId(null);
    setNewOrderNum(nextOrder);
    setDraft(questionDraft(null));
    setTargetStatus('draft');
    setErrors({});
    setConflict(false);
    window.history.replaceState(null, '', listeningMcqHref(contentId));
  };
  const chooseBlock = (id: string) => {
    if (!collection || !id) return;
    if (dirty) {
      setSwitchTarget(id);
      setConfirm('switch');
      return;
    }
    install(collection.items.find((item) => item.id === id) || null, collection);
  };
  const applyConfirm = () => {
    if (confirm === 'leave') {
      leaving.current = true;
      window.location.assign(`/admin/listening/content/${encodeURIComponent(contentId)}`);
    }
    if (confirm === 'reload') void load();
    if (confirm === 'discard-pending') {
      clearReceipt(receiptKey(profile.id, contentId));
      setPending(null);
      void load();
    }
    if (confirm === 'switch' && collection && switchTarget) install(collection.items.find((item) => item.id === switchTarget) || null, collection);
    if (confirm === 'new-block') startNewBlock();
    setSwitchTarget(null);
    setConfirm(null);
  };

  if (loading) return <main className="almc-shell"><div className="almc-state" role="status">Đang đọc content và toàn bộ MCQ blocks…</div></main>;
  if (!content || !collection || loadError) return <main className="almc-shell"><div className="alc-banner is-error" role="alert"><strong>Không mở được trình biên tập Multiple Choice</strong><span>{loadError || 'Không có canonical snapshot hợp lệ.'}</span></div><div className="almc-state-actions"><a className="adm-btn-secondary" href="/admin/listening">Về Listening</a>{contentId && collection && !collection.importedCount && <a className="adm-btn-secondary" href={listeningMcqRollbackHref(contentId)}>Mở HTML rollback</a>}<button className="adm-btn-primary" type="button" onClick={() => void load()}>Thử lại</button></div></main>;

  return <main className="almc-shell">
    <nav className="almc-breadcrumb" aria-label="Breadcrumb"><a href="/admin/listening">Listening content</a><span aria-hidden="true">/</span><a href={`/admin/listening/content/${encodeURIComponent(contentId)}`}>{content.title}</a><span aria-hidden="true">/</span><span>Biên tập Multiple Choice</span></nav>
    {banner && <div className={`alc-banner is-${banner.kind}`} role={banner.kind === 'error' ? 'alert' : 'status'}><strong>{banner.title}</strong><span>{banner.text}</span></div>}
    {collection.importedCount > 0 && <div className="alc-banner is-warning" role="status"><strong>{collection.importedCount} MCQ block thuộc kho đề</strong><span>Các block importer ở order {collection.importedOrders.join(', ')} được quản lý trong Listening Tests và không bị editor standalone đọc hoặc ghi đè.</span></div>}
    <header className="almc-hero"><div><p className="alc-eyebrow">Listening · Answer-key authoring</p><h1>Soạn câu hỏi MCQ theo bằng chứng</h1><p>Đối chiếu từng câu với audio và transcript, viết bốn lựa chọn rõ ràng rồi đánh dấu đúng một answer key.</p><code>{content.id}</code></div><dl><div><dt>Content</dt><dd>{STATUS_LABEL[content.status]}</dd></div><div><dt>Block</dt><dd>{baseline ? `#${baseline.orderNum}` : `Mới #${orderNum}`}</dd></div><div><dt>Câu hỏi</dt><dd>{draft.length}/{MAX_MCQ_QUESTIONS}</dd></div><div><dt>Điều kiện đạt</dt><dd>Đúng 100%</dd></div></dl></header>
    {pending && <section className="almc-receipt" aria-labelledby="almc-pending"><div><p className="alc-eyebrow">Pending receipt</p><h2 id="almc-pending">Lượt lưu cần đối chiếu</h2><p>{new Date(pending.startedAt).toLocaleString('vi-VN')} · chỉ GET, không tự POST lại.</p></div><div><button className="adm-btn-primary" type="button" disabled={busy} onClick={() => void reconcile()}>Đối chiếu canonical</button><button className="adm-btn-secondary" type="button" disabled={busy} onClick={() => setConfirm('discard-pending')}>Bỏ biên nhận & tải lại</button></div></section>}
    {conflict && <section className="almc-receipt is-conflict" aria-labelledby="almc-conflict"><div><p className="alc-eyebrow">Version conflict</p><h2 id="almc-conflict">Block đã đổi ở nơi khác</h2><p>Form này không ghi đè canonical. Tải snapshot mới trước khi sửa tiếp.</p></div><button className="adm-btn-primary" type="button" onClick={() => setConfirm('reload')}>Tải canonical mới</button></section>}
    <section className="almc-workspace">
      <div className="almc-main">
        <section className="almc-card" aria-labelledby="almc-source"><div className="almc-card-head"><div><p className="alc-eyebrow">1 · Đối chiếu nguồn</p><h2 id="almc-source">Audio và transcript canonical</h2></div><span>{Math.round(content.durationSeconds)} giây</span></div>{content.audioUrl ? <audio-player src={content.audioUrl} duration-hint={content.durationSeconds} refetch-url={`/admin/listening/content/${encodeURIComponent(contentId)}`} /> : <div className="alc-banner is-error" role="alert"><strong>Không có signed audio URL</strong><span>Vẫn có thể soạn nháp, nhưng cần nghe kiểm tra trước khi publish.</span></div>}<details className="almc-transcript"><summary>Mở transcript chỉ đọc</summary><div>{content.transcript || 'Content chưa có transcript.'}</div></details></section>
        <section className="almc-card" aria-labelledby="almc-questions"><div className="almc-card-head"><div><p className="alc-eyebrow">2 · Soạn câu hỏi</p><h2 id="almc-questions">Một câu, bốn lựa chọn, một answer key</h2></div><span>{MIN_MCQ_QUESTIONS}–{MAX_MCQ_QUESTIONS} câu</span></div><p className="almc-support">Mỗi câu chỉ hỏi một ý có thể kiểm chứng từ nguồn. Các distractor cần hợp lý nhưng không mơ hồ hoặc có hơn một đáp án đúng.</p>{errors.form && <strong className="almc-field-error" role="alert">{errors.form}</strong>}{errors.questions && <strong className="almc-field-error" role="alert">{errors.questions}</strong>}<span className="almc-sr-only" role="status" aria-live="polite">{reorderNotice}</span>
          <ol className="almc-questions">{draft.map((question, index) => <li key={question.key} className={errors[`question-${index}`] || errors[`answer-${index}`] || question.options.some((_, optionIndex) => errors[`option-${index}-${optionIndex}`]) ? 'has-error' : ''}>
            <div className="almc-question-head"><span>Câu {index + 1}</span><div><button type="button" className="adm-btn-secondary" aria-label={`Đưa câu ${index + 1} lên`} aria-disabled={index === 0} disabled={locked} onClick={() => moveQuestion(index, -1)}>↑</button><button type="button" className="adm-btn-secondary" aria-label={`Đưa câu ${index + 1} xuống`} aria-disabled={index === draft.length - 1} disabled={locked} onClick={() => moveQuestion(index, 1)}>↓</button><button type="button" className="adm-btn-danger" aria-label={`Xóa câu ${index + 1}`} disabled={locked || draft.length <= MIN_MCQ_QUESTIONS} onClick={() => removeQuestion(index)}>Xóa</button></div></div>
            <label className="almc-field" htmlFor={`almc-stem-${index}`}><span>Đề bài học viên sẽ thấy</span><textarea id={`almc-stem-${index}`} value={question.stem} maxLength={MAX_MCQ_STEM_LENGTH} disabled={locked} aria-invalid={Boolean(errors[`question-${index}`])} aria-describedby={`almc-stem-help-${index}${errors[`question-${index}`] ? ` almc-stem-error-${index}` : ''}`} onChange={(event) => updateQuestion(index, { stem: event.target.value })} /><small id={`almc-stem-help-${index}`}>Một ý duy nhất, diễn đạt độc lập. {question.stem.length}/{MAX_MCQ_STEM_LENGTH}</small>{errors[`question-${index}`] && <strong id={`almc-stem-error-${index}`} className="almc-field-error" role="alert">{errors[`question-${index}`]}</strong>}</label>
            <fieldset className="almc-options" aria-describedby={errors[`answer-${index}`] ? `almc-answer-error-${index}` : undefined}><legend>Bốn lựa chọn · chọn đáp án đúng</legend>{question.options.map((option, optionIndex) => <div className={`almc-option${question.answerIdx === optionIndex ? ' is-answer' : ''}`} key={`${question.key}:option:${optionIndex}`}><label className="almc-answer-pick"><input type="radio" name={`correct-${question.key}`} checked={question.answerIdx === optionIndex} disabled={locked} aria-label={`Chọn ${LETTERS[optionIndex]} làm đáp án đúng câu ${index + 1}`} onChange={() => updateQuestion(index, { answerIdx: optionIndex })} /><span>{LETTERS[optionIndex]}</span><small>{question.answerIdx === optionIndex ? 'Đáp án đúng' : 'Distractor'}</small></label><label className="almc-field" htmlFor={`almc-option-${index}-${optionIndex}`}><span>Nội dung lựa chọn {LETTERS[optionIndex]}</span><input id={`almc-option-${index}-${optionIndex}`} value={option} maxLength={MAX_MCQ_OPTION_LENGTH} disabled={locked} aria-invalid={Boolean(errors[`option-${index}-${optionIndex}`])} aria-describedby={`almc-option-help-${index}-${optionIndex}${errors[`option-${index}-${optionIndex}`] ? ` almc-option-error-${index}-${optionIndex}` : ''}`} onChange={(event) => updateOption(index, optionIndex, event.target.value)} /><small id={`almc-option-help-${index}-${optionIndex}`}>{option.length}/{MAX_MCQ_OPTION_LENGTH}</small>{errors[`option-${index}-${optionIndex}`] && <strong id={`almc-option-error-${index}-${optionIndex}`} className="almc-field-error" role="alert">{errors[`option-${index}-${optionIndex}`]}</strong>}</label></div>)}{errors[`answer-${index}`] && <strong id={`almc-answer-error-${index}`} className="almc-field-error" role="alert">{errors[`answer-${index}`]}</strong>}</fieldset>
          </li>)}</ol>
          <button className="adm-btn-secondary almc-add" type="button" disabled={locked || draft.length >= MAX_MCQ_QUESTIONS} onClick={addQuestion}>+ Thêm câu hỏi</button>
          <div className="almc-score-truth"><strong>Cách chấm thực tế</strong><ol><li>Mỗi câu được so khớp chính xác theo answer index A, B, C hoặc D; không có chấm một phần trong từng câu.</li><li>Điểm toàn block = số câu đúng chia tổng số câu; câu bỏ trống tính sai.</li><li>Backend chỉ đánh dấu hoàn thành đúng khi học viên trả lời đúng 100% câu hỏi.</li></ol></div>
        </section>
      </div>
      <aside className="almc-side"><section><p className="alc-eyebrow">Block identity</p><h2>{collection.items.length ? `${collection.items.length} MCQ block` : 'Chưa có block'}</h2>{collection.items.length > 0 && <label className="almc-field" htmlFor="almc-block"><span>Block đang sửa</span><select id="almc-block" value={selectedId || ''} disabled={locked} onChange={(event) => chooseBlock(event.target.value)}>{!baseline && <option value="">Block mới #{orderNum}</option>}{collection.items.map((item) => <option key={item.id} value={item.id}>#{item.orderNum} · {STATUS_LABEL[item.status]} · {item.questions.length} câu</option>)}</select></label>}<button className="adm-btn-secondary" type="button" disabled={locked || nextListeningMcqOrder(collection) == null} onClick={() => dirty ? setConfirm('new-block') : startNewBlock()}>Thêm MCQ block</button><dl><div><dt>Exercise ID</dt><dd><code>{baseline?.id || 'Tạo mới khi lưu'}</code></dd></div><div><dt>Order</dt><dd><code>#{orderNum}</code></dd></div><div><dt>Version</dt><dd><code>{baseline?.updatedAt || 'expected_absent'}</code></dd></div><div><dt>Nguồn</dt><dd>{content.sourceType || '—'}</dd></div></dl></section><section><p className="alc-eyebrow">Publication</p><fieldset className="almc-status-options"><legend>Trạng thái đích</legend>{(['draft', 'published', 'archived'] as Status[]).map((status) => <label className="almc-radio" key={status}><input type="radio" name="mcq-status" checked={targetStatus === status} disabled={locked || (status === 'published' && Boolean(competingPublishedOrder))} onChange={() => { setTargetStatus(status); setErrors((current) => ({ ...current, form: '' })); }} /><span><strong>{STATUS_LABEL[status]}</strong><small>{status === 'draft' ? 'Chưa phục vụ người học.' : status === 'published' ? 'Content cha phải published và không có MCQ block published khác.' : 'Giữ block nhưng không phục vụ người học.'}</small></span></label>)}</fieldset>{competingPublishedOrder && <p className="almc-publication-note">Block #{competingPublishedOrder} đang phục vụ người học. Mỗi content chỉ có một MCQ block published; hãy chuyển block đó về nháp hoặc lưu trữ trước.</p>}{targetStatus === 'published' && content.status !== 'published' && <p className="almc-publication-note">Block có thể được lưu published, nhưng người học chưa thấy cho tới khi content cha cũng published.</p>}</section>{!collection.importedCount && <a className="alc-rollback" href={listeningMcqRollbackHref(contentId)}>Mở bản HTML rollback ↗</a>}</aside>
    </section>
    <footer className="almc-actions"><div><strong>{dirty ? 'Có thay đổi chưa lưu' : 'Đã đồng bộ canonical'}</strong><span>{pending ? 'Đang chờ đối chiếu receipt' : conflict ? 'Phải tải version mới' : `Block #${orderNum} · ${STATUS_LABEL[targetStatus]}`}</span></div><div><button className="adm-btn-secondary" type="button" disabled={busy} onClick={() => dirty ? setConfirm('leave') : window.location.assign(`/admin/listening/content/${encodeURIComponent(contentId)}`)}>Về chi tiết</button><button className="adm-btn-secondary" type="button" disabled={!dirty || locked} onClick={() => baseline ? install(baseline, collection) : startNewBlock()}>Hoàn tác</button><button className="adm-btn-primary" type="button" disabled={!dirty || locked} onClick={() => void save(targetStatus)}>{busy ? 'Đang đối chiếu…' : targetStatus === 'published' ? 'Lưu & xuất bản' : targetStatus === 'archived' ? 'Lưu bản lưu trữ' : 'Lưu bản nháp'}</button></div></footer>
    <Dialog open={confirm !== null} title={confirm === 'leave' ? 'Rời editor và bỏ thay đổi?' : confirm === 'discard-pending' ? 'Bỏ biên nhận chưa đối chiếu?' : confirm === 'switch' ? 'Chuyển block và bỏ thay đổi?' : confirm === 'new-block' ? 'Tạo block mới và bỏ thay đổi?' : 'Tải canonical mới?'} description={confirm === 'discard-pending' ? 'Chỉ bỏ sau khi đã kiểm tra record; thao tác này không hoàn tác POST có thể đã tới backend.' : 'Thay đổi chưa lưu sẽ không thể khôi phục.'} busy={false} onClose={() => setConfirm(null)} actions={<><button className="adm-btn-secondary" type="button" onClick={() => setConfirm(null)}>Tiếp tục sửa</button><button className="adm-btn-danger" type="button" onClick={applyConfirm}>{confirm === 'discard-pending' ? 'Bỏ biên nhận' : confirm === 'reload' ? 'Tải lại' : confirm === 'new-block' ? 'Tạo block mới' : 'Bỏ thay đổi'}</button></>} />
  </main>;
}
