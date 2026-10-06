'use client';

import { useEffect, useState } from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import type { ApiGetJson } from '@/lib/openapi-contract';

export type GrammarLessonQuestion = ApiGetJson<'/api/grammar/lessons/items/{item_id}'>['questions'][number];

export function GrammarText({ value }: { value: string }) {
  const [html, setHtml] = useState('');
  useEffect(() => {
    setHtml(DOMPurify.sanitize(marked.parse(value, { async: false, breaks: true }) as string,
      { ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'code', 'ul', 'ol', 'li', 'blockquote'], ALLOWED_ATTR: [] }));
  }, [value]);
  return html ? <div className="agl-text" dangerouslySetInnerHTML={{ __html: html }} />
    : <div className="agl-text agl-prewrap">{value}</div>;
}

export function GrammarLessonFeedback({ question, educator = false }: { question: GrammarLessonQuestion; educator?: boolean }) {
  if (question.type === 'writing') {
    if (question.answer_text == null) return null;
    const feedback = question.writing_feedback;
    return <div className="agl-feedback">
      <strong>Đã lưu bài viết · Chưa chấm điểm</strong>
      <h4>{educator ? 'Bài viết của học viên' : 'Bài viết của bạn'}</h4><p className="agl-prewrap">{question.answer_text}</p>
      {feedback && <>
        <h4>Đáp án tham khảo</h4><GrammarText value={feedback.model_answer} />
        {feedback.accepted_variants.length > 0 && <><h4>Cách diễn đạt khác được chấp nhận</h4><ul>{feedback.accepted_variants.map((variant, i) => <li key={i}><GrammarText value={variant} /></li>)}</ul></>}
        <h4>Tiêu chí đối chiếu</h4><GrammarText value={feedback.rubric} />
        <GrammarText value={feedback.detailed_rubric} />
        <p><strong>Năng lực luyện tập:</strong> {feedback.writing_skill}</p>
      </>}
      {question.explanation && <GrammarText value={question.explanation} />}
    </div>;
  }
  if (question.selected_index == null) return null;
  return <div className={`agl-feedback ${question.is_correct ? 'is-correct' : 'is-incorrect'}`}>
    <strong>{question.is_correct ? 'Đúng' : 'Cần sửa'}</strong>
    <p>Đáp án: {question.correct_index != null ? question.options[question.correct_index] : '—'}</p>
    {question.explanation && <GrammarText value={question.explanation} />}
    {question.distractor_explanations && <details><summary>Vì sao các lựa chọn khác chưa phù hợp?</summary>
      {question.distractor_explanations.map((value, index) => value.trim() && index !== question.correct_index ? <div key={index}><strong>{String.fromCharCode(65 + index)}.</strong><GrammarText value={value} /></div> : null)}
    </details>}
  </div>;
}
