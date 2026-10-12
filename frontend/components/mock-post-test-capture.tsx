'use client';

import { useMemo, useState } from 'react';

type QuestionState = { question_number: number; blank?: boolean };
export type CaptureEnvelope = {
  attempt_id: string;
  post_test_capture_required: true;
  question_states: QuestionState[];
};

const ATTRIBUTIONS = [
  ['SA_GUESSED', 'Guessed'],
  ['SA_DID_NOT_KNOW_WORD', 'Did not know the word'],
  ['SA_COULD_NOT_LOCATE', 'Could not locate the information'],
  ['SA_DID_NOT_PARSE_SENTENCE', 'Could not understand the sentence'],
  ['SA_MISSED_PARAPHRASE', 'Missed the paraphrase'],
  ['SA_CHOSE_MENTIONED_DISTRACTOR', 'Chose a mentioned distractor'],
  ['SA_LOST_AUDIO_POSITION', 'Lost my place in the recording'],
  ['SA_COULD_NOT_HEAR_CHUNK', 'Could not hear the phrase'],
  ['SA_FORGOT_BEFORE_ANSWERING', 'Forgot before answering'],
  ['SA_ANSWER_FORM_OR_SPELLING', 'Wrong word form or spelling'],
  ['SA_RAN_OUT_OF_TIME', 'Ran out of time'],
  ['SA_CHANGED_FROM_RIGHT_TO_WRONG', 'Changed a correct answer to an incorrect one'],
  ['SA_TECHNICAL_PROBLEM', 'Technical problem'],
  ['SA_OTHER', 'Not sure why'],
] as const;

const CONFIDENCE = [
  [1, 'Guessed'], [2, 'Very unsure'], [3, 'Unsure'], [4, 'Fairly sure'], [5, 'Supported by evidence'],
] as const;

export function MockPostTestCapture({
  skill,
  envelope,
  onComplete,
  completionLabel = 'Save and view results',
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
      setError('Unable to save your confidence ratings. Please try again.');
    } finally { setBusy(false); }
  };

  return <main className="exam-result-shell post-capture-shell">
    <section className="exam-result-card post-capture-card">
      <p className="exam-result-eyebrow">{context === 'mock' ? 'BEFORE SUBMITTING THIS SECTION' : 'BEFORE VIEWING RESULTS'}</p>
      <h1>Rate your confidence</h1>
      <p>Choose a confidence level for each answer. These ratings do not affect your score.</p>
      <div className="post-capture-legend" aria-label="Confidence levels"><span><b>1</b> Guessed</span><span><b>3</b> Unsure</span><span><b>5</b> Confident with evidence</span></div>
      <div className="post-capture-grid">
        {questions.map((q) => <fieldset key={q.question_number} className="post-capture-item">
          <legend><strong>Question {q.question_number}</strong>{q.blank ? ' · unanswered' : ''}</legend>
          <div className="post-capture-scale" role="group" aria-label={`Confidence for question ${q.question_number}`}>{CONFIDENCE.map(([value, label]) => <button
            type="button"
            className={confidence[q.question_number] === value ? 'is-selected' : ''}
            aria-pressed={confidence[q.question_number] === value}
            aria-label={`${value}: ${label}`}
            title={label}
            onClick={() => setConfidence((old) => ({ ...old, [q.question_number]: value }))}
            key={value}
          >{value}</button>)}</div>
          {(q.blank || (confidence[q.question_number] && confidence[q.question_number] <= 2)) ? <details>
            <summary>Why are you unsure? <small>optional · choose up to 2</small></summary>
            <div className="post-capture-reasons">{ATTRIBUTIONS.map(([code, label]) => <label key={code}><input type="checkbox" checked={(attribution[q.question_number] || []).includes(code)} onChange={() => toggleAttribution(q.question_number, code)} /> <span>{label}</span></label>)}</div>
          </details> : null}
        </fieldset>)}
      </div>
      {error ? <p className="post-capture-error" role="alert">{error}</p> : null}
      <button className="exam-btn exam-btn--primary" type="button" disabled={Boolean(missing) || busy} onClick={() => void submit()}>
        {busy ? 'Saving…' : missing ? `${missing} questions still need a rating` : completionLabel}
      </button>
    </section>
  </main>;
}
