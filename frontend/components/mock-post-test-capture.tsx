'use client';

import { useMemo, useState } from 'react';

type QuestionState = { question_number: number; blank?: boolean };
export type CaptureEnvelope = {
  attempt_id: string;
  post_test_capture_required: true;
  question_states: QuestionState[];
};

const ATTRIBUTIONS = [
  ['SA_GUESSED', 'Em đã đoán'],
  ['SA_DID_NOT_KNOW_WORD', 'Không biết từ'],
  ['SA_COULD_NOT_LOCATE', 'Không tìm được vị trí thông tin'],
  ['SA_MISSED_PARAPHRASE', 'Bỏ lỡ paraphrase'],
  ['SA_LOST_AUDIO_POSITION', 'Mất vị trí trong audio'],
  ['SA_COULD_NOT_HEAR_CHUNK', 'Không nghe rõ cụm từ'],
  ['SA_ANSWER_FORM_OR_SPELLING', 'Sai dạng từ / chính tả'],
  ['SA_RAN_OUT_OF_TIME', 'Hết thời gian'],
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

  return <main className="exam-result-shell">
    <section className="exam-result-card" style={{ maxWidth: 1040, margin: '32px auto' }}>
      <p className="exam-result-eyebrow">{context === 'mock' ? 'TRƯỚC KHI NỘP PHẦN THI' : 'TRƯỚC KHI XEM KẾT QUẢ'}</p>
      <h1>Tự đánh giá mức chắc chắn</h1>
      <p>Chọn mức 1–5 cho từng câu. Bước này giúp giáo viên phân biệt kiến thức thật với câu đoán; đáp án, điểm và giải thích vẫn đang được giữ kín.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }}>
        {questions.map((q) => <fieldset key={q.question_number} style={{ border: '1px solid #d8ddd9', borderRadius: 12, padding: 12 }}>
          <legend><strong>Câu {q.question_number}</strong>{q.blank ? ' · bỏ trống' : ''}</legend>
          <label>Mức chắc chắn
            <select value={confidence[q.question_number] || ''} onChange={(event) => setConfidence((old) => ({ ...old, [q.question_number]: Number(event.target.value) }))}>
              <option value="">Chọn 1–5</option>
              <option value="1">1 · Đoán hoàn toàn</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5 · Rất chắc</option>
            </select>
          </label>
          {(q.blank || (confidence[q.question_number] && confidence[q.question_number] <= 2)) ? <details>
            <summary>Vì sao em chưa chắc? (tối đa 2)</summary>
            {ATTRIBUTIONS.map(([code, label]) => <label key={code} style={{ display: 'block' }}><input type="checkbox" checked={(attribution[q.question_number] || []).includes(code)} onChange={() => toggleAttribution(q.question_number, code)} /> {label}</label>)}
          </details> : null}
        </fieldset>)}
      </div>
      {error ? <p role="alert">{error}</p> : null}
      <button className="exam-btn exam-btn--primary" type="button" disabled={Boolean(missing) || busy} onClick={() => void submit()}>
        {busy ? 'Đang lưu…' : missing ? `Còn ${missing} câu chưa chọn` : completionLabel}
      </button>
    </section>
  </main>;
}
