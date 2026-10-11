'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth/auth-provider';
import type { components } from '@/types/api';
import { ListeningQuestionAudio } from './listening-question-audio';
import { readSourceGapAnswers, writeSourceGapAnswers } from '@/lib/listening-source-responses.mjs';

type Question = components['schemas']['SourceSupplementalQuestion'];
type Clip = components['schemas']['SourceQuestionClip'];

export function ListeningSourceSupplement({ question, manifest, clip, active, reload }: { question: Question; manifest: string; clip?: Clip; active: boolean; reload?: () => void }) {
  const { user } = useAuth();
  const key = JSON.stringify(['listening-source-draft-v1', user?.id, manifest, question.item_id]);
  const [answer, setAnswer] = useState('');
  const [saved, setSaved] = useState(false);
  const [draftError, setDraftError] = useState(false);
  useEffect(() => { try { setAnswer(localStorage.getItem(key) || ''); } catch { setAnswer(''); } setSaved(false); setDraftError(false); }, [key]);
  function update(value: string) { setAnswer(value); try { localStorage.setItem(key, value); setSaved(true); setDraftError(false); } catch { setSaved(false); setDraftError(true); } }
  const choice = ['single_choice', 'multiple_choice', 'map_label'].includes(question.response_type);
  return <article className="programme-question source-supplement">
    <span className="programme-question__number">{question.source_display_number}</span>
    <div className="programme-question__body"><p>{question.prompt}</p><p className="source-notice">Tự luyện · {question.reason_vi}</p>
      <ListeningQuestionAudio key={clip?.url} clip={clip} active={active} reload={reload} />
      {choice ? <div className="programme-options">{(question.options || []).map((option) => <label key={option.id}><input type={question.response_type === 'multiple_choice' ? 'checkbox' : 'radio'} name={`supplement-${key}`} checked={question.response_type === 'multiple_choice' ? answer.split(', ').includes(option.id) : answer === option.id} onChange={() => {
        if (question.response_type !== 'multiple_choice') return update(option.id);
        const values = new Set(answer.split(', ').filter(Boolean));
        if (values.has(option.id)) values.delete(option.id); else if (!question.selection_count || values.size < question.selection_count) values.add(option.id);
        update([...values].join(', '));
      }} /><span><strong>{option.id}</strong>{option.label}</span></label>)}</div> : question.response_type === 'multi_gap_completion' ? <fieldset className="source-multiple-gaps"><legend>Điền từng chỗ trống</legend>{(question.fields || []).map((field) => <label key={field.field_id}>{field.prompt}<input value={readSourceGapAnswers(answer)[field.field_id] || ''} onChange={(event) => update(writeSourceGapAnswers({ ...readSourceGapAnswers(answer), [field.field_id]: event.target.value }))} /></label>)}</fieldset> : <label>Câu trả lời thử{question.word_limit ? ` · tối đa ${question.word_limit} từ` : ''}<textarea rows={2} value={answer} onChange={(event) => update(event.target.value)} /></label>}
      <small role="status">{draftError ? 'Chưa lưu được bản nháp; giữ tab này để tránh mất câu trả lời' : saved ? 'Đã lưu bản nháp trên thiết bị này' : 'Bản nháp chỉ lưu trên thiết bị này'} · Câu này không gửi chấm hoặc tính điểm.</small>
    </div>
  </article>;
}
