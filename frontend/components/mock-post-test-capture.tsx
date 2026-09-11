'use client';

import { useMemo, useState } from 'react';

type QuestionState = { question_number: number; blank?: boolean };
export type CaptureEnvelope = {
  attempt_id: string;
  post_test_capture_required: true;
  question_states: QuestionState[];
};

const ATTRIBUTIONS = [
  ['SA_GUESSED', 'Đã đoán'],
  ['SA_DID_NOT_KNOW_WORD', 'Không biết từ'],
  ['SA_COULD_NOT_LOCATE', 'Không tìm được vị trí thông tin'],
  ['SA_DID_NOT_PARSE_SENTENCE', 'Không phân tích được câu'],
  ['SA_MISSED_PARAPHRASE', 'Bỏ lỡ paraphrase'],
  ['SA_CHOSE_MENTIONED_DISTRACTOR', 'Chọn thông tin nhiễu được nhắc tới'],
  ['SA_LOST_AUDIO_POSITION', 'Mất vị trí trong audio'],
  ['SA_COULD_NOT_HEAR_CHUNK', 'Không nghe rõ cụm từ'],
  ['SA_FORGOT_BEFORE_ANSWERING', 'Nghe được nhưng quên trước khi trả lời'],
  ['SA_ANSWER_FORM_OR_SPELLING', 'Sai dạng từ / chính tả'],
  ['SA_RAN_OUT_OF_TIME', 'Hết thời gian'],
  ['SA_CHANGED_FROM_RIGHT_TO_WRONG', 'Đổi từ đáp án đúng sang sai'],
  ['SA_TECHNICAL_PROBLEM', 'Có sự cố kỹ thuật'],
  ['SA_OTHER', 'Chưa biết vì sao'],
] as const;

const CONFIDENCE = [
  [1, 'Đoán'], [2, 'Rất không chắc'], [3, 'Phân vân'], [4, 'Khá chắc'], [5, 'Có bằng chứng'],
] as const;

export function MockPostTestCapture({
  skill,
  envelope,
  onComplete,
  completionLabel = 'Lưu và xem kết quả',
  context = 'practice',
}: {
  skill: 'reading' | 'listening';
  envelope: CaptureEnvelope;
  onComplete: (payload: any) => void;
  completionLabel?: string;
  context?: 'practice' | 'mock';
}) {
  const questions = useMemo(
    () => [...(envelope.question_states || [])].sort((a, b) => a.question_number - b.question_number),
    [envelope.question_states],
  );
  const [confidence, setConfidence] = useState<Record<number, number>>({});
  const [attribution, setAttribution] = useState<Record<number, string[]>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const missing = questions.filter((q) => !confidence[q.question_number]).length;

  const toggleAttribution = (q: number, code: string) => {
    setAttribution((previous) => {
      const current = previous[q] || [];
      const next = current.includes(code)
        ? current.filter((value) => value !== code)
        : current.length < 2 ? [...current, code] : current;
      return { ...previous, [q]: next };
    });
  };

  const submit = async () => {
    if (missing || busy) return;
    setBusy(true); setError('');
    try {
      const payload = await window.api.post(
        `/api/mock-corrections/${skill}/attempts/${encodeURIComponent(envelope.attempt_id)}/post-test-capture`,
        {
          items: questions.map((q) => ({
            question_number: q.question_number,
            confidence: confidence[q.question_number],
            self_attribution: attribution[q.question_number] || [],
          })),
        },
      );
      onComplete(payload);
    } catch (caught: any) {
      setError(caught?.message || 'Không lưu được phần tự đánh giá. Hãy thử lại.');
    } finally { setBusy(false); }
  };

  return <main className="exam-result-shell post-capture-shell">
    <section className="exam-result-card post-capture-card">
      <p className="exam-result-eyebrow">{context === 'mock' ? 'TRƯỚC KHI NỘP PHẦN THI' : 'TRƯỚC KHI XEM KẾT QUẢ'}</p>
      <h1>Tự đánh giá mức chắc chắn</h1>
      <p>Chạm một mức cho từng câu. Dữ liệu này không ảnh hưởng điểm; nó giúp phát hiện câu đoán đúng và lỗi hiểu sai nhưng rất chắc chắn.</p>
      <div className="post-capture-legend" aria-label="Ý nghĩa mức chắc chắn"><span><b>1</b> Đoán</span><span><b>3</b> Phân vân</span><span><b>5</b> Chắc chắn và có bằng chứng</span></div>
      <div className="post-capture-grid">
        {questions.map((q) => <fieldset key={q.question_number} className="post-capture-item">
          <legend><strong>Câu {q.question_number}</strong>{q.blank ? ' · bỏ trống' : ''}</legend>
          <div className="post-capture-scale" role="group" aria-label={`Mức chắc chắn câu ${q.question_number}`}>{CONFIDENCE.map(([value, label]) => <button
            type="button"
            className={confidence[q.question_number] === value ? 'is-selected' : ''}
            aria-pressed={confidence[q.question_number] === value}
            aria-label={`${value}: ${label}`}
            title={label}
            onClick={() => setConfidence((old) => ({ ...old, [q.question_number]: value }))}
            key={value}
          >{value}</button>)}</div>
          {(q.blank || (confidence[q.question_number] && confidence[q.question_number] <= 2)) ? <details>
            <summary>Vì sao bạn chưa chắc? <small>không bắt buộc · tối đa 2</small></summary>
            <div className="post-capture-reasons">{ATTRIBUTIONS.map(([code, label]) => <label key={code}><input type="checkbox" checked={(attribution[q.question_number] || []).includes(code)} onChange={() => toggleAttribution(q.question_number, code)} /> <span>{label}</span></label>)}</div>
          </details> : null}
        </fieldset>)}
      </div>
      {error ? <p className="post-capture-error" role="alert">{error}</p> : null}
      <button className="exam-btn exam-btn--primary" type="button" disabled={Boolean(missing) || busy} onClick={() => void submit()}>
        {busy ? 'Đang lưu…' : missing ? `Còn ${missing} câu chưa chọn` : completionLabel}
      </button>
    </section>
  </main>;
}
