'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import type { ApiGetJson, ApiPostJson } from '@/lib/openapi-contract';
import type { components } from '@/types/api';
import { useAuth } from '@/lib/auth/auth-provider';
import { GrammarLessonFeedback, GrammarText, type GrammarLessonQuestion } from '@/components/grammar-lesson-feedback';

type Lesson = ApiGetJson<'/api/grammar/lessons/items/{item_id}'>;
type Started = ApiPostJson<'/api/grammar/lessons/items/{item_id}/start'>;
type Answered = ApiPostJson<'/api/grammar/lessons/items/{item_id}/answers'>;

function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'Không thể kết nối. Vui lòng thử lại.';
}

function LessonNotes({ value }: { value: string }) {
  const [html, setHtml] = useState('');
  useEffect(() => {
    setHtml(DOMPurify.sanitize(marked.parse(value, { async: false }) as string));
  }, [value]);
  return html
    ? <div className="agl-notes md-body" dangerouslySetInnerHTML={{ __html: html }} />
    : <div className="agl-notes agl-notes-loading">{value}</div>;
}

export function AssignedGrammarLesson() {
  const { status: authStatus, user } = useAuth();
  const itemId = useSearchParams()?.get('assignment_item') || '';
  const requestSequence = useRef(0);
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [choices, setChoices] = useState<Record<string, number>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const draftContext = useRef('');
  const feedbackFocus = useRef('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    if (authStatus !== 'signed-in') return;
    const requestId = ++requestSequence.current;
    if (!itemId) { setError('Thiếu mã bài được giao.'); setLoading(false); return; }
    setLoading(true); setLesson(null); setBusy(false); setError('');
    try {
      const value = await window.api.get<Lesson>(`/api/grammar/lessons/items/${encodeURIComponent(itemId)}`);
      if (requestId === requestSequence.current) setLesson(value);
    } catch (caught) { if (requestId === requestSequence.current) setError(errorText(caught)); }
    finally { if (requestId === requestSequence.current) setLoading(false); }
  }, [authStatus, user?.id, itemId]);

  useEffect(() => {
    if (authStatus === 'signed-in') {
      const context = `${user?.id}:${itemId}`;
      if (draftContext.current !== context) { setDrafts({}); draftContext.current = context; }
      setChoices({}); void reload();
    }
    else {
      ++requestSequence.current;
      setLesson(null); setChoices({}); setDrafts({}); draftContext.current = ''; setBusy(false); setError('');
      setLoading(authStatus === 'initial-loading');
    }
  }, [authStatus, reload]);

  useEffect(() => {
    if (!feedbackFocus.current) return;
    document.getElementById(`feedback-${feedbackFocus.current}`)?.focus();
    feedbackFocus.current = '';
  }, [lesson]);

  const start = async () => {
    if (busy || !itemId) return;
    const requestId = requestSequence.current;
    setBusy(true); setError('');
    try {
      const value = await window.api.post<Started>(`/api/grammar/lessons/items/${encodeURIComponent(itemId)}/start`);
      if (requestId === requestSequence.current) setLesson(value);
    } catch (caught) { if (requestId === requestSequence.current) setError(errorText(caught)); }
    finally { if (requestId === requestSequence.current) setBusy(false); }
  };

  const answer = async (question: GrammarLessonQuestion) => {
    const questionId = question.id;
    const writing = question.type === 'writing';
    if (busy || !itemId || (writing ? !drafts[questionId]?.trim() : choices[questionId] == null)) return;
    const requestId = requestSequence.current;
    setBusy(true); setError('');
    try {
      const payload: components['schemas']['AnswerBody'] = {
        question_id: questionId, ...(writing ? { answer_text: drafts[questionId] } : { selected_index: choices[questionId] }),
      };
      const value = await window.api.post<Answered>(`/api/grammar/lessons/items/${encodeURIComponent(itemId)}/answers`, payload);
      if (requestId === requestSequence.current) { feedbackFocus.current = questionId; setLesson(value); }
    } catch (caught) { if (requestId === requestSequence.current) setError(errorText(caught)); }
    finally { if (requestId === requestSequence.current) setBusy(false); }
  };

  if (authStatus === 'initial-loading' || loading) return <main className="agl-shell" role="status">Đang tải bài Grammar…</main>;
  if (authStatus === 'signed-out') return <main className="agl-shell"><p>Đăng nhập để mở bài Grammar được giao.</p><a href="/login">Đăng nhập</a></main>;
  if (!lesson) return <main className="agl-shell"><a href="/my-class">← Lớp của tôi</a><div className="agl-alert" role="alert">{error || 'Không tìm thấy bài này.'}</div><button type="button" onClick={() => void reload()}>Thử lại</button></main>;

  const article = lesson.article;
  const articleHref = article ? `/grammar/${encodeURIComponent(article.category)}/${encodeURIComponent(article.slug)}` : null;
  const remaining = lesson.question_count - lesson.answered_count;
  const hasTeaching = Boolean(lesson.lesson_notes || articleHref);
  const objectiveCount = lesson.objective_count ?? lesson.question_count;
  return <main className="agl-shell">
    <a className="agl-back" href="/my-class">← Lớp của tôi</a>
    <header className="agl-hero"><p>COURSE 5 · GRAMMAR LESSON</p><h1>{lesson.lesson_id} · {lesson.title}</h1><p>{lesson.focus}</p>
      <div className="agl-meta"><span>{lesson.answered_count}/{lesson.question_count} câu đã làm</span>{lesson.due_at && <span>Hạn: {new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(lesson.due_at))}</span>}</div>
      {Boolean(lesson.writing_count) && <p>{objectiveCount} câu trắc nghiệm · {lesson.writing_count} câu viết{Boolean(lesson.supplementary_count) && ` (gồm ${lesson.supplementary_count} câu viết bổ sung)`}.</p>}
    </header>
    {lesson.instructions && <section className="agl-card"><h2>Dặn dò của giáo viên</h2><p>{lesson.instructions}</p></section>}
    <section className="agl-card"><h2>1. Ôn bài học</h2><p>Đọc lý thuyết và ví dụ trước khi làm phần luyện tập. Có thể quay lại bài học bất kỳ lúc nào.</p>
      {lesson.learning_objectives?.length ? <><h3>Mục tiêu luyện tập</h3><ul>{lesson.learning_objectives.map((objective) => <li key={objective}>{objective}</li>)}</ul></> : null}
      {lesson.lesson_notes && <LessonNotes key={lesson.lesson_notes} value={lesson.lesson_notes} />}
      {articleHref && <a className="av-button av-button-primary" href={articleHref} target="_blank" rel="noopener noreferrer">Mở {article?.title} ↗</a>}
      {!hasTeaching && <p role="alert">Tài liệu bài học hiện chưa sẵn sàng.</p>}
    </section>
    <section className="agl-card" aria-labelledby="practice-title"><h2 id="practice-title">2. Luyện tập</h2>
      {lesson.status === 'scheduled' && <p role="status">Bài chưa đến giờ mở.</p>}
      {lesson.status === 'paused' && <p role="status">Bài đang tạm khóa. Tiến độ đã lưu vẫn được giữ lại.</p>}
      {lesson.status === 'expired' && <p role="status">Bài đã hết hạn. Những câu đã làm vẫn được giữ để xem lại.</p>}
      {lesson.status === 'completed' && <p className="agl-result" role="status">Đã hoàn thành: {lesson.correct_count}/{objectiveCount} câu đúng ({Math.round(lesson.correct_count / objectiveCount * 100)}%){Boolean(lesson.writing_count) && ` phần trắc nghiệm. Phần viết: đã lưu ${lesson.writing_answered_count}/${lesson.writing_count} câu, chưa chấm điểm`}. Xem lại phần chữa bài bên dưới.</p>}
      {lesson.status === 'not_started' && <button className="av-button av-button-primary" type="button" onClick={() => void start()} disabled={busy || !hasTeaching}>{busy ? 'Đang mở…' : 'Bắt đầu luyện tập'}</button>}
      {lesson.status === 'in_progress' && <p role="status">Còn {remaining} câu. Mỗi câu được lưu khi bạn kiểm tra đáp án hoặc lưu bài viết.</p>}
      {error && <div className="agl-alert" role="alert">{error} <button type="button" onClick={() => void reload()}>Tải lại</button></div>}
      <div className="agl-questions">{lesson.questions.map((question, index) => {
        const writing = question.type === 'writing';
        const answered = writing ? question.answer_text != null : question.selected_index != null;
        return <article className="agl-question" key={question.id}>
          <h3>Câu {index + 1}{question.supplementary ? ' · Viết bổ sung' : ''}</h3>
          {lesson.content_version === 'v3' && <p className="agl-source-id">{question.id} · {question.format_code}</p>}
          <GrammarText value={question.prompt} />
          {writing ? <>
            {question.output_requirements && <div id={`requirements-${question.id}`}><strong>Yêu cầu bài viết</strong><GrammarText value={question.output_requirements} /></div>}
            {!answered && <label className="agl-writing">Bài viết câu {index + 1}<textarea maxLength={8000} rows={5} aria-describedby={question.output_requirements ? `requirements-${question.id}` : undefined} disabled={busy || !lesson.can_submit} value={drafts[question.id] || ''} onChange={(event) => setDrafts((prev) => ({ ...prev, [question.id]: event.target.value }))} /></label>}
          </> : <fieldset disabled={answered || busy || !lesson.can_submit}><legend className="sr-only">Chọn đáp án câu {index + 1}</legend>
            {question.options.map((option, optionIndex) => <label className="agl-option" key={optionIndex}><input type="radio" name={question.id} checked={(answered ? question.selected_index : choices[question.id]) === optionIndex} onChange={() => setChoices((prev) => ({ ...prev, [question.id]: optionIndex }))} /><span>{String.fromCharCode(65 + optionIndex)}. {option}</span></label>)}
          </fieldset>}
          {!answered && lesson.can_submit && <button className="av-button av-button-primary" type="button" disabled={busy || (writing ? !drafts[question.id]?.trim() : choices[question.id] == null)} onClick={() => void answer(question)}>{busy ? 'Đang lưu…' : writing ? 'Lưu và đối chiếu' : 'Kiểm tra câu này'}</button>}
          {answered && <div id={`feedback-${question.id}`} tabIndex={-1}><GrammarLessonFeedback question={question} /></div>}
        </article>;
      })}</div>
    </section>
  </main>;
}
