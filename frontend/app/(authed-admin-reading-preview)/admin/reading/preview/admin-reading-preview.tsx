'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { useAdminProfile } from '@/components/admin-access-gate';
import { Dialog, messageOf } from '@/components/admin-directory-ui';
import {
  READING_QUESTION_LABELS, diagramRole, imagePromptForQuestion,
  normalizeReadingAdminPreview, normalizeReadingImageDeleteAck, normalizeReadingImageUploadAck,
  questionsByPassage,
} from '@/lib/admin-reading-preview-model.mjs';

type Option = { label: string; text: string };
type ImagePrompt = { id: string | null; type: string | null; qrange: string | null; prompt: string };
type Passage = { id: string; order: number; slug: string; title: string; bodyMarkdown: string; wordCount: number | null; estimatedMinutes: number | null; topicTags: string[]; status: string | null; imagePrompts: ImagePrompt[] };
type Question = { id: string | null; qNum: number; passageId: string; passageOrder: number | null; type: string; prompt: string; skillTag: string | null; subSkill: string | null; options: Option[]; imageUrl: string | null; template: { summaryText: string | null; imageStoragePath: string | null; imageSource: string | null; choose: number | null; paragraphLabels: string[]; extras: Record<string, unknown> }; answers: string[]; alternatives: string[]; explanation: string | null };
type Test = { id: string | null; testId: string; title: string; module: string | null; status: string | null; timeLimitMinutes: number | null; passageCount: number; totalQuestions: number; bandTarget: number | null; passages: Passage[]; questions: Question[] };
type Snapshot = { key: string; test: Test; issues: string[]; readAt: string };
type Banner = { kind: 'success' | 'warning' | 'error' | 'info'; title: string; detail: string };
type DeleteAction = { question: Question } | null;

const statusOf = (caught: unknown) => typeof caught === 'object' && caught !== null && 'status' in caught ? Number((caught as { status?: unknown }).status) : 0;
const definitive = (status: number) => status >= 400 && status < 500 && ![408, 425, 429].includes(status);
const timeText = (value: string) => new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
const questionLabels = READING_QUESTION_LABELS as Readonly<Record<string, string>>;

function Markdown({ value }: { value: string }) {
  const [html, setHtml] = useState('');
  useEffect(() => {
    let attempts = 0; let timer = 0; let disposed = false;
    const render = () => {
      if (disposed) return;
      if (window.renderMarkdown) { setHtml(window.renderMarkdown(value, { breaks: false })); return; }
      if (attempts++ < 50) timer = window.setTimeout(render, 50);
    };
    setHtml(''); render(); return () => { disposed = true; window.clearTimeout(timer); };
  }, [value]);
  return html ? <div className="arp-markdown md-body" dangerouslySetInnerHTML={{ __html: html }}/> : <pre className="arp-markdown-fallback">{value}</pre>;
}

function AnswerList({ values, empty }: { values: string[]; empty: string }) {
  return values.length ? <div className="arp-answer-chips">{values.map((value, index) => <code key={`${value}-${index}`}>{value}</code>)}</div> : <span className="arp-muted">{empty}</span>;
}

function TemplateInspector({ question }: { question: Question }) {
  const template = question.template;
  if (!template.summaryText && template.choose == null && !template.paragraphLabels.length && !template.imageStoragePath && !Object.keys(template.extras).length) return null;
  return <div className="arp-template"><strong>Template đã parse</strong>{template.summaryText && <pre>{template.summaryText}</pre>}<dl>{template.choose != null && <div><dt>Choose</dt><dd>{template.choose}</dd></div>}{template.paragraphLabels.length > 0 && <div><dt>Paragraph labels</dt><dd>{template.paragraphLabels.join(', ')}</dd></div>}{template.imageStoragePath && <div><dt>Image path</dt><dd><code>{template.imageStoragePath}</code></dd></div>}{Object.keys(template.extras).length > 0 && <div><dt>Extras</dt><dd><code>{JSON.stringify(template.extras)}</code></dd></div>}</dl></div>;
}

function QuestionCard({ question, passageQuestions, index, passage, busy, onUpload, onDelete }: { question: Question; passageQuestions: Question[]; index: number; passage: Passage; busy: boolean; onUpload(question: Question, file: File): void; onDelete(question: Question): void }) {
  const role = diagramRole(passageQuestions, index) as { lead: boolean; leadQNum: number } | null;
  const prompt = role?.lead ? imagePromptForQuestion(passage, question.qNum) as ImagePrompt | null : null;
  const canManageImage = Boolean(role?.lead && question.id);
  const copyPrompt = async () => {
    if (!prompt?.prompt) return;
    try { await navigator.clipboard.writeText(prompt.prompt); } catch {
      const promptNode = document.getElementById(`arp-imgprompt-${question.qNum}`);
      if (promptNode) window.getSelection()?.selectAllChildren(promptNode);
    }
  };
  return <article className="arp-question" id={`q${question.qNum}`} data-question={question.qNum}>
    <header className="arp-question__head"><span className="arp-qnum">Q{question.qNum}</span><div><strong>{questionLabels[question.type] || question.type}</strong><code>{question.type}</code></div>{question.skillTag && <span className="arp-skill">{question.skillTag}</span>}</header>
    <div className="arp-question__body"><p className="arp-prompt">{question.prompt || <em>Không có prompt</em>}</p>
      {question.options.length > 0 && <ol className="arp-options">{question.options.map((option, optionIndex) => <li key={`${option.label}-${optionIndex}`}><strong>{option.label}</strong><span>{option.text}</span></li>)}</ol>}
      <TemplateInspector question={question}/>
      {role && !role.lead && <p className="arp-shared-image">Dùng chung ảnh sơ đồ với Q{role.leadQNum}; quản lý ảnh ở câu đầu block.</p>}
      {role?.lead && <section className="arp-image-workflow" aria-label={`Ảnh sơ đồ cho câu ${question.qNum}`}><div className="arp-image-workflow__head"><div><strong>Ảnh dùng cho block câu hỏi</strong><span>{question.template.imageStoragePath ? 'Đã có ảnh canonical' : 'Chưa có ảnh; student view dùng fallback văn bản'}</span></div>{canManageImage && <div><label className="adm-btn-secondary adm-btn-sm arp-file-label">{busy ? 'Đang xử lý…' : question.template.imageStoragePath ? 'Thay ảnh' : 'Tải ảnh'}<input className="arp-file-input" type="file" aria-label={`${question.template.imageStoragePath ? 'Thay' : 'Tải'} ảnh sơ đồ cho câu ${question.qNum}`} accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) onUpload(question, file); event.currentTarget.value = ''; }}/></label>{question.template.imageStoragePath && <button className="adm-btn-danger adm-btn-sm" type="button" disabled={busy} onClick={() => onDelete(question)}>Xóa ảnh</button>}</div>}</div>
        {question.imageUrl ? <img src={question.imageUrl} alt={`Sơ đồ cho block bắt đầu tại câu ${question.qNum}`}/> : question.template.imageStoragePath ? <div className="arp-image-unavailable">Metadata ảnh tồn tại nhưng signed preview chưa khả dụng.</div> : null}
        {prompt && <details className="arp-imgprompt"><summary>Prompt tạo ảnh được trích từ file</summary><div><code>{[prompt.id, prompt.type, prompt.qrange && `Q${prompt.qrange}`].filter(Boolean).join(' · ')}</code><button className="adm-btn-secondary adm-btn-sm" type="button" onClick={() => void copyPrompt()}>Copy prompt</button></div><pre id={`arp-imgprompt-${question.qNum}`}>{prompt.prompt}</pre></details>}
      </section>}
    </div>
    <dl className="arp-keys"><div><dt>Đáp án canonical</dt><dd><AnswerList values={question.answers} empty="Thiếu đáp án"/></dd></div><div><dt>Đáp án thay thế</dt><dd><AnswerList values={question.alternatives} empty="Không có"/></dd></div><div className="is-wide"><dt>Lời giải</dt><dd>{question.explanation || <span className="arp-muted">Chưa có lời giải</span>}</dd></div></dl>
  </article>;
}

export function AdminReadingPreview() {
  const profile = useAdminProfile(); const params = useSearchParams(); const testId = (params?.get('test_id') || '').trim(); const key = `${profile.id}:${testId}`;
  const scope = useRef(key); const sequence = useRef(0); const [snapshot, setSnapshot] = useState<Snapshot | null>(null); const [loading, setLoading] = useState(true); const [loadError, setLoadError] = useState<string | null>(null); const [banner, setBanner] = useState<Banner | null>(null); const [activePassage, setActivePassage] = useState<string | null>(null); const [busyQuestion, setBusyQuestion] = useState<string | null>(null); const [deleteAction, setDeleteAction] = useState<DeleteAction>(null);
  const current = snapshot?.key === key ? snapshot : null; const test = current?.test || null; const passage = test?.passages.find((item) => item.id === activePassage) || test?.passages[0] || null;
  const passageQuestions = useMemo(() => passage && test ? questionsByPassage(test, passage.id) as Question[] : [], [passage, test]);

  const load = useCallback(async (preserve = true) => {
    if (!testId) { setLoading(false); setLoadError('Thiếu test_id. Hãy mở preview từ một dòng L3 Test trong thư viện.'); return null; }
    const owner = key; const request = ++sequence.current; setLoading(true); setLoadError(null);
    try {
      const normalized = normalizeReadingAdminPreview(await window.api.get<unknown>(`/admin/reading/content/tests/${encodeURIComponent(testId)}`)) as { test: Test; issues: string[] } | null;
      if (!normalized) throw new Error('Payload preview không đúng contract gốc.');
      if (request !== sequence.current || scope.current !== owner) return null;
      setSnapshot({ key: owner, ...normalized, readAt: new Date().toISOString() });
      const deepLinkedQuestion = /^#q(\d+)$/.exec(window.location.hash);
      const deepLinkedPassage = deepLinkedQuestion
        ? normalized.test.questions.find((item) => item.qNum === Number(deepLinkedQuestion[1]))?.passageId
        : null;
      setActivePassage((previous) => deepLinkedPassage || (normalized.test.passages.some((item) => item.id === previous) ? previous : normalized.test.passages[0]?.id || null));
      return normalized;
    } catch (caught) {
      if (request === sequence.current && scope.current === owner) setLoadError(`${preserve && current ? 'Không thể làm mới — đang giữ snapshot trước. ' : ''}${messageOf(caught)}`);
      return null;
    } finally { if (request === sequence.current && scope.current === owner) setLoading(false); }
  }, [current, key, testId]);

  useEffect(() => { scope.current = key; setSnapshot(null); setBanner(null); setActivePassage(null); setBusyQuestion(null); setDeleteAction(null); void load(false); return () => { sequence.current += 1; }; }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!test) return;
    const selectDeepLinkedPassage = () => {
      const match = /^#q(\d+)$/.exec(window.location.hash);
      if (!match) return;
      const owner = test.questions.find((item) => item.qNum === Number(match[1]))?.passageId;
      if (owner) setActivePassage(owner);
    };
    selectDeepLinkedPassage();
    window.addEventListener('hashchange', selectDeepLinkedPassage);
    return () => window.removeEventListener('hashchange', selectDeepLinkedPassage);
  }, [test]);
  useEffect(() => { if (!test || !activePassage || !window.location.hash.startsWith('#q')) return; const timer = window.setTimeout(() => document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ block: 'center' }), 60); return () => window.clearTimeout(timer); }, [activePassage, test]);

  const upload = async (question: Question, file: File) => {
    if (!question.id || busyQuestion) return;
    if (file.type && !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return setBanner({ kind: 'error', title: 'File không được hỗ trợ', detail: 'Chỉ chấp nhận PNG, JPEG hoặc WebP.' });
    if (file.size < 100 || file.size > 5 * 1024 * 1024) return setBanner({ kind: 'error', title: 'Kích thước ảnh không hợp lệ', detail: 'Ảnh phải từ 100 B đến 5 MB.' });
    const owner = key; setBusyQuestion(question.id); setBanner(null); const form = new FormData(); form.append('image_file', file);
    let acknowledgedPath: string | null = null;
    try {
      const ack = normalizeReadingImageUploadAck(await window.api.upload<unknown>(`/admin/reading/questions/${encodeURIComponent(question.id)}/upload-diagram-image`, form), question.id) as { path: string } | null;
      if (scope.current !== owner) return;
      if (!ack) throw new Error('ACK upload ảnh không khớp question identity.');
      acknowledgedPath = ack.path;
      const refreshed = await load(false); const canonical = refreshed?.test.questions.find((item) => item.id === question.id);
      if (!canonical || canonical.template.imageStoragePath !== ack.path) throw new Error('Canonical GET chưa xác nhận đúng ảnh vừa upload.');
      setBanner({ kind: 'success', title: `Đã cập nhật ảnh Q${question.qNum}`, detail: 'ACK và canonical question payload đã khớp.' });
    } catch (caught) {
      if (scope.current !== owner) return; const status = statusOf(caught);
      const refreshed = definitive(status) ? null : await load(false);
      const canonical = refreshed?.test.questions.find((item) => item.id === question.id);
      if (acknowledgedPath && canonical?.template.imageStoragePath === acknowledgedPath) {
        setBanner({ kind: 'success', title: `Đã đối chiếu ảnh Q${question.qNum}`, detail: 'Mutation response không trọn vẹn nhưng canonical GET xác nhận đúng ảnh mới.' });
      } else {
        setBanner({ kind: status && definitive(status) ? 'error' : 'warning', title: definitive(status) ? 'Upload bị từ chối' : 'Chưa xác minh được upload', detail: `${messageOf(caught)} Không tự upload lại; kiểm tra snapshot canonical vừa tải.` });
      }
    } finally { if (scope.current === owner) setBusyQuestion(null); }
  };

  const removeImage = async () => {
    const question = deleteAction?.question; if (!question?.id || busyQuestion) return;
    const owner = key; setBusyQuestion(question.id); setBanner(null);
    try {
      const ack = normalizeReadingImageDeleteAck(await window.api.delete<unknown>(`/admin/reading/questions/${encodeURIComponent(question.id)}/diagram-image`), question.id);
      if (scope.current !== owner) return;
      if (!ack) throw new Error('ACK xóa ảnh không khớp question identity.');
      const refreshed = await load(false); const canonical = refreshed?.test.questions.find((item) => item.id === question.id);
      if (!canonical || canonical.template.imageStoragePath) throw new Error('Canonical GET vẫn còn image metadata.');
      setDeleteAction(null); setBanner({ kind: 'success', title: `Đã xóa ảnh Q${question.qNum}`, detail: 'Metadata canonical đã được xóa; student view sẽ dùng fallback.' });
    } catch (caught) {
      if (scope.current !== owner) return; const refreshed = definitive(statusOf(caught)) ? null : await load(false); const canonical = refreshed?.test.questions.find((item) => item.id === question.id);
      if (canonical && !canonical.template.imageStoragePath) { setDeleteAction(null); setBanner({ kind: 'success', title: `Đã đối chiếu xóa ảnh Q${question.qNum}`, detail: 'Mutation response không rõ nhưng canonical GET xác nhận ảnh đã được xóa.' }); }
      else setBanner({ kind: definitive(statusOf(caught)) ? 'error' : 'warning', title: definitive(statusOf(caught)) ? 'Xóa ảnh bị từ chối' : 'Chưa xác minh được xóa ảnh', detail: `${messageOf(caught)} Không tự gửi lại mutation.` });
    } finally { if (scope.current === owner) setBusyQuestion(null); }
  };

  if (!testId) return <main className="arp-shell"><div className="arp-state is-error" role="alert"><strong>Không có đề để xem trước</strong><p>URL cần tham số <code>test_id</code>. Hãy quay lại thư viện và chọn “Xem trước”.</p><a className="adm-btn-primary" href="/admin/reading/content">Về thư viện Reading</a></div></main>;
  return <main className="arp-shell">
    <header className="arp-hero"><div><p className="arp-eyebrow">Reading · Paper QA</p><h1>{test?.title || 'Kiểm định đề Reading'}</h1><p>{test ? `${test.testId} · ${test.module || 'module chưa đặt'}` : `Đang đọc ${testId}`}</p></div><div className="arp-hero__actions"><a className="adm-btn-secondary" href={`/pages/admin/reading/preview.html?test_id=${encodeURIComponent(testId)}`} target="_blank" rel="noreferrer">Legacy rollback ↗</a><a className="adm-btn-primary" href="/admin/reading/content">Về thư viện</a></div></header>
    <div className="arp-mode-note"><strong>Chế độ kiểm định admin</strong><span>Đáp án, alternatives và lời giải được mở để rà nội dung. Đây không phải mô phỏng lượt làm của học viên.</span></div>
    {banner && <div className={`arp-banner is-${banner.kind}`} role={banner.kind === 'error' ? 'alert' : 'status'}><div><strong>{banner.title}</strong><span>{banner.detail}</span></div><button type="button" aria-label="Đóng thông báo" onClick={() => setBanner(null)}>×</button></div>}
    {loadError && <div className="arp-banner is-error" role="alert"><div><strong>{current ? 'Đang giữ snapshot cũ' : 'Không tải được đề'}</strong><span>{loadError}{current ? ` · đọc lúc ${timeText(current.readAt)}` : ''}</span></div><button className="adm-btn-secondary adm-btn-sm" type="button" onClick={() => void load()} disabled={loading}>Thử lại</button></div>}
    {current?.issues.length ? <section className="arp-contract" aria-labelledby="arp-contract-title"><div><strong id="arp-contract-title">{current.issues.length} vấn đề contract cần rà</strong><span>Preview chỉ hiển thị các record đủ identity; không suy diễn dữ liệu bị thiếu.</span></div><ul>{current.issues.map((issue, index) => <li key={`${issue}-${index}`}>{issue}</li>)}</ul></section> : null}
    {!current ? <div className="arp-state" role="status"><span className="arp-spinner"/><strong>{loading ? 'Đang đọc đề và answer key…' : 'Chưa có snapshot canonical'}</strong></div> : <>
      <section className="arp-metrics" aria-label="Tổng quan đề"><div><span>Passages</span><strong>{test!.passageCount}</strong></div><div><span>Questions</span><strong>{test!.totalQuestions}</strong></div><div><span>Thời lượng</span><strong>{test!.timeLimitMinutes ? `${test!.timeLimitMinutes}′` : '—'}</strong></div><div><span>Trạng thái</span><strong className={`is-${test!.status || 'unknown'}`}>{test!.status || 'unknown'}</strong></div><div><span>QA issues</span><strong>{current.issues.length}</strong></div></section>
      {!test!.passages.length ? <div className="arp-state is-error"><strong>Không có passage hợp lệ</strong><p>Không thể kiểm định câu hỏi cho tới khi payload được sửa.</p></div> : <div className="arp-workspace">
        <aside className="arp-nav" aria-label="Điều hướng passage"><div className="arp-nav__head"><span>Cấu trúc đề</span><button type="button" onClick={() => void load()} disabled={loading || Boolean(busyQuestion)}>{loading ? 'Đang tải…' : 'Làm mới'}</button></div>{test!.passages.map((item) => { const count = questionsByPassage(test, item.id).length; return <button type="button" className={item.id === passage?.id ? 'is-active' : ''} aria-current={item.id === passage?.id ? 'true' : undefined} key={item.id} onClick={() => { setActivePassage(item.id); window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); }}><span>Passage {item.order}</span><strong>{item.title}</strong><small>{count} câu · {item.wordCount ?? '—'} từ</small></button>; })}<a href={`/reading/review?admin_test_id=${encodeURIComponent(testId)}`} target="_blank" rel="noreferrer">Xem như học viên ↗</a></aside>
        {passage && <div className="arp-main"><section className="arp-passage"><header><div><p className="arp-eyebrow">Passage {passage.order}</p><h2>{passage.title}</h2><div><code>{passage.slug}</code>{passage.status && <span>{passage.status}</span>}{passage.wordCount != null && <span>{passage.wordCount} từ</span>}</div></div><span>{passageQuestions.length} câu</span></header><Markdown value={passage.bodyMarkdown}/></section>
          <section className="arp-questions" aria-labelledby="arp-questions-title"><header><div><p className="arp-eyebrow">Question inspector</p><h2 id="arp-questions-title">Đáp án & lời giải</h2></div><span>Q{passageQuestions[0]?.qNum ?? '—'}–Q{passageQuestions.at(-1)?.qNum ?? '—'}</span></header>{passageQuestions.length ? passageQuestions.map((question, index) => <QuestionCard key={question.id || question.qNum} question={question} passageQuestions={passageQuestions} index={index} passage={passage} busy={Boolean(question.id) && busyQuestion === question.id} onUpload={(row, file) => void upload(row, file)} onDelete={(row) => setDeleteAction({ question: row })}/>) : <div className="arp-state"><strong>Passage này chưa có câu hỏi hợp lệ</strong></div>}</section>
        </div>}
      </div>}
    </>}
    <Dialog open={deleteAction !== null} title={`Xóa ảnh block Q${deleteAction?.question.qNum || ''}?`} description="Ảnh trong Storage và metadata canonical sẽ bị xóa. Student view quay về fallback văn bản; thao tác chỉ được báo thành công sau readback." onClose={() => setDeleteAction(null)} busy={Boolean(busyQuestion)} actions={<><button className="adm-btn-secondary" type="button" onClick={() => setDeleteAction(null)} disabled={Boolean(busyQuestion)}>Hủy</button><button className="adm-btn-danger" type="button" onClick={() => void removeImage()} disabled={Boolean(busyQuestion)}>{busyQuestion ? 'Đang đối chiếu…' : 'Xóa ảnh'}</button></>}/>
  </main>;
}
