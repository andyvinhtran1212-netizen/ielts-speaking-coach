'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { ApiGetJson, ApiPostJson } from '@/lib/openapi-contract';

type Lesson = ApiGetJson<'/api/grammar/lessons/items/{item_id}'>;
type Started = ApiPostJson<'/api/grammar/lessons/items/{item_id}/start'>;
type Answered = ApiPostJson<'/api/grammar/lessons/items/{item_id}/answers'>;

function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'Không thể kết nối. Vui lòng thử lại.';
}

export function AssignedGrammarLesson() {
  const itemId = useSearchParams()?.get('assignment_item') || '';
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [choices, setChoices] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    if (!itemId) { setError('Thiếu mã bài được giao.'); setLoading(false); return; }
    setLoading(true); setLesson(null); setError('');
    try {
      setLesson(await window.api.get<Lesson>(`/api/grammar/lessons/items/${encodeURIComponent(itemId)}`));
    } catch (caught) { setError(errorText(caught)); }
    finally { setLoading(false); }
  }, [itemId]);

  useEffect(() => { void reload(); }, [reload]);

  const start = async () => {
    if (busy || !itemId) return;
    setBusy(true); setError('');
    try {
      setLesson(await window.api.post<Started>(`/api/grammar/lessons/items/${encodeURIComponent(itemId)}/start`));
    } catch (caught) { setError(errorText(caught)); }
    finally { setBusy(false); }
  };

  const answer = async (questionId: string) => {
    if (busy || !itemId || choices[questionId] == null) return;
    setBusy(true); setError('');
    try {
      setLesson(await window.api.post<Answered>(`/api/grammar/lessons/items/${encodeURIComponent(itemId)}/answers`, {
        question_id: questionId, selected_index: choices[questionId],
      }));
    } catch (caught) { setError(errorText(caught)); }
    finally { setBusy(false); }
  };

  if (loading) return <main className="agl-shell" role="status">Đang tải bài Grammar…</main>;
  if (!lesson) return <main className="agl-shell"><a href="/my-class">← Lớp của tôi</a><div className="agl-alert" role="alert">{error || 'Không tìm thấy bài này.'}</div><button type="button" onClick={() => void reload()}>Thử lại</button></main>;

  const article = lesson.article;
  const articleHref = article ? `/grammar/${encodeURIComponent(article.category)}/${encodeURIComponent(article.slug)}` : null;
  const remaining = lesson.question_count - lesson.answered_count;
  return <main className="agl-shell">
    <a className="agl-back" href="/my-class">← Lớp của tôi</a>
    <header className="agl-hero"><p>COURSE 5 · GRAMMAR LESSON</p><h1>{lesson.lesson_id} · {lesson.title}</h1><p>{lesson.focus}</p>
      <div className="agl-meta"><span>{lesson.answered_count}/{lesson.question_count} câu đã làm</span>{lesson.due_at && <span>Hạn: {new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(lesson.due_at))}</span>}</div>
    </header>
    {lesson.instructions && <section className="agl-card"><h2>Dặn dò của giáo viên</h2><p>{lesson.instructions}</p></section>}
    <section className="agl-card"><h2>1. Ôn bài học</h2><p>Đọc lý thuyết và ví dụ trước khi làm phần luyện tập. Có thể quay lại bài học bất kỳ lúc nào.</p>{articleHref ? <a className="av-button av-button-primary" href={articleHref} target="_blank" rel="noopener noreferrer">Mở {article?.title} ↗</a> : <p role="alert">Tài liệu bài học hiện chưa sẵn sàng.</p>}</section>
    <section className="agl-card" aria-labelledby="practice-title"><h2 id="practice-title">2. Luyện tập</h2>
      {lesson.status === 'scheduled' && <p role="status">Bài chưa đến giờ mở.</p>}
      {lesson.status === 'paused' && <p role="status">Bài đang tạm khóa. Tiến độ đã lưu vẫn được giữ lại.</p>}
      {lesson.status === 'expired' && <p role="status">Bài đã hết hạn. Những câu đã làm vẫn được giữ để xem lại.</p>}
      {lesson.status === 'completed' && <p className="agl-result" role="status">Đã hoàn thành: {lesson.correct_count}/{lesson.question_count} câu đúng ({Math.round(lesson.correct_count / lesson.question_count * 100)}%). Xem lại phần chữa bài bên dưới.</p>}
      {lesson.status === 'not_started' && <button className="av-button av-button-primary" type="button" onClick={() => void start()} disabled={busy || !articleHref}>{busy ? 'Đang mở…' : 'Bắt đầu luyện tập'}</button>}
      {lesson.status === 'in_progress' && <p role="status">Còn {remaining} câu. Mỗi câu được lưu ngay khi bạn chọn “Kiểm tra”.</p>}
      {error && <div className="agl-alert" role="alert">{error} <button type="button" onClick={() => void reload()}>Tải lại</button></div>}
      <div className="agl-questions">{lesson.questions.map((question, index) => {
        const answered = question.selected_index != null;
        return <article className="agl-question" key={question.id}>
          <h3>Câu {index + 1}</h3><p>{question.prompt}</p>
          <fieldset disabled={answered || busy || !lesson.can_submit}><legend className="sr-only">Chọn đáp án câu {index + 1}</legend>
            {question.options.map((option, optionIndex) => <label className="agl-option" key={optionIndex}><input type="radio" name={question.id} checked={(answered ? question.selected_index : choices[question.id]) === optionIndex} onChange={() => setChoices((prev) => ({ ...prev, [question.id]: optionIndex }))} /><span>{String.fromCharCode(65 + optionIndex)}. {option}</span></label>)}
          </fieldset>
          {!answered && lesson.can_submit && <button className="av-button av-button-primary" type="button" disabled={busy || choices[question.id] == null} onClick={() => void answer(question.id)}>{busy ? 'Đang lưu…' : 'Kiểm tra câu này'}</button>}
          {answered && <div className={`agl-feedback ${question.is_correct ? 'is-correct' : 'is-incorrect'}`}><strong>{question.is_correct ? 'Đúng' : 'Cần sửa'}</strong><p>Đáp án: {question.correct_index != null ? question.options[question.correct_index] : '—'}</p><p>{question.explanation}</p></div>}
        </article>;
      })}</div>
    </section>
  </main>;
}
