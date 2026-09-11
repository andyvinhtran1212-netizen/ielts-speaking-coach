'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type Skill = 'reading' | 'listening';
type EventName = 'correction_result_seen' | 'evidence_attempt_submitted'
  | 'hint_revealed'
  | 'full_explanation_opened' | 'correction_output_submitted';

const STATE_STAGE: Record<string, number> = {
  RESULT_ONLY: 0, EVIDENCE_ATTEMPTED: 1, LOCATION_HINT_SEEN: 2,
  DECISIVE_HINT_SEEN: 3, FULL_EXPLANATION_SEEN: 4,
  CORRECTION_OUTPUT_SUBMITTED: 5, CORRECTION_VERIFIED: 6,
  TRANSFER_PASSED: 7, RETEST_SCHEDULED: 8, MASTERED: 9, REOPENED: 0,
};
const EVENT_STAGE: Record<EventName, number> = {
  correction_result_seen: 0, evidence_attempt_submitted: 1,
  hint_revealed: 2,
  full_explanation_opened: 4, correction_output_submitted: 5,
};

function lines(value: unknown) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return String(value ?? '').split(/\n+|\s+·\s+/).map((row) => row.trim()).filter(Boolean);
}

export function WebExplanationPanel({ object, skill, attemptId, questionNumber, persistenceEnabled = true }: {
  object: any;
  skill: Skill;
  attemptId: string | null;
  questionNumber: number;
  persistenceEnabled?: boolean;
}) {
  const explanation = object?.explanation || {};
  const remediation = object?.remediation || {};
  const repair = object?.correction_flow?.same_source_repair || {};
  const evidenceRows = lines(explanation.source_evidence).length
    ? explanation.source_evidence
    : lines(explanation.evidence_location_or_audio_anchor);
  const [evidenceAttempt, setEvidenceAttempt] = useState('');
  const [correctedAnswer, setCorrectedAnswer] = useState('');
  const [errorMechanism, setErrorMechanism] = useState('');
  const [nextAction, setNextAction] = useState('');
  const [stage, setStage] = useState(0);
  const [busy, setBusy] = useState<EventName | ''>('');
  const [error, setError] = useState('');
  const eventIds = useRef<Partial<Record<EventName, string>>>({});
  const candidateSkills = Array.isArray(remediation.candidate_skill_codes)
    ? remediation.candidate_skill_codes.filter((row: any) => row?.code)
    : [];
  const canPersist = persistenceEnabled && Boolean(attemptId) && Number.isInteger(questionNumber);

  const record = useCallback(async (eventName: EventName, payload: Record<string, unknown> = {}) => {
    if (!canPersist) {
      const localStage = eventName === 'hint_revealed' && payload.hint_type === 'decisive' ? 3 : EVENT_STAGE[eventName];
      setStage((current) => Math.max(current, localStage));
      return true;
    }
    const eventId = eventIds.current[eventName] || crypto.randomUUID();
    eventIds.current[eventName] = eventId;
    setBusy(eventName);
    setError('');
    try {
      const response = await window.api.post<{ state?: string; evidence_response?: string | null }>(
        `/api/mock-corrections/${skill}/attempts/${encodeURIComponent(attemptId || '')}/items/${questionNumber}/events`,
        { event_id: eventId, event_name: eventName, client_occurred_at: new Date().toISOString(), client_version: 'web-review/1.0', payload },
      );
      if (!response?.state || STATE_STAGE[response.state] === undefined) throw new Error('Backend không trả lại correction state hợp lệ.');
      setStage(STATE_STAGE[response.state]);
      if (response.evidence_response) setEvidenceAttempt(response.evidence_response);
      delete eventIds.current[eventName];
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught || 'Không ghi được tiến trình sửa bài.'));
      return false;
    } finally {
      setBusy('');
    }
  }, [attemptId, canPersist, questionNumber, skill]);

  useEffect(() => { void record('correction_result_seen'); }, [record]);

  return <section className="wex-panel" aria-label="Phương hướng sửa bài mới">
    <header className="wex-panel__head">
      <div><span>WEB EXPLANATION</span><h3>Chữa theo bằng chứng, không chỉ xem đáp án</h3></div>
      <small>{skill === 'reading' ? 'Reading' : 'Listening'} · {stage >= 5 ? 'đã nộp correction output' : 'đang lưu tiến trình'}</small>
    </header>

    {error ? <div className="wex-alert" role="alert"><span>{error}</span><button type="button" onClick={() => void record('correction_result_seen')} disabled={Boolean(busy)}>Thử kết nối lại</button></div> : null}

    <div className="wex-stage">
      <strong>1. Tự chỉ ra bằng chứng trước</strong>
      <p>{skill === 'reading'
        ? 'Ghi đoạn, câu hoặc cụm từ em đã dựa vào khi chọn đáp án.'
        : 'Ghi vị trí audio hoặc cụm em nghe được khi chọn đáp án.'}</p>
      <textarea
        rows={2}
        maxLength={2000}
        value={evidenceAttempt}
        onChange={(event) => setEvidenceAttempt(event.target.value)}
        placeholder={skill === 'reading' ? 'Ví dụ: Passage 2, đoạn 4…' : 'Ví dụ: khoảng 12:30, người nữ nói…'}
        disabled={stage > 0 || Boolean(busy)}
      />
      {stage === 0 ? <button type="button" disabled={!evidenceAttempt.trim() || Boolean(busy)} onClick={() => void record('evidence_attempt_submitted', { evidence_response: evidenceAttempt })}>{busy === 'evidence_attempt_submitted' ? 'Đang lưu…' : 'Chốt bằng chứng của em'}</button> : null}
      {stage === 1 ? <button type="button" disabled={Boolean(busy)} onClick={() => void record('hint_revealed', { hint_type: 'location' })}>{busy === 'hint_revealed' ? 'Đang lưu…' : 'Xem vị trí nguồn'}</button> : null}
    </div>

    {stage >= 2 ? <div className="wex-stage">
      <strong>2. Đối chiếu vị trí nguồn</strong>
      {Array.isArray(evidenceRows) ? <ul>{evidenceRows.map((row: any, index: number) => <li key={`${index}-${String(row?.location || row)}`}>{String(row?.location || row?.quote || row)}</li>)}</ul> : <p>{String(evidenceRows || '')}</p>}
      {stage === 2 ? <button type="button" disabled={Boolean(busy)} onClick={() => void record('hint_revealed', { hint_type: 'decisive' })}>{busy === 'hint_revealed' ? 'Đang lưu…' : 'Xem chữ/cụm quyết định'}</button> : null}
    </div> : null}

    {stage >= 3 ? <div className="wex-stage">
      <strong>3. Chữ hoặc paraphrase quyết định</strong>
      <p>{String(explanation.decisive_word_or_paraphrase || explanation.paraphrase || 'Chưa có gợi ý quyết định.')}</p>
      {stage === 3 ? <button type="button" disabled={Boolean(busy)} onClick={() => void record('full_explanation_opened')}>{busy === 'full_explanation_opened' ? 'Đang lưu…' : 'Mở lời giải đầy đủ'}</button> : null}
    </div> : null}

    {stage >= 4 ? <div className="wex-stage wex-stage--full">
      <strong>4. Hiểu cơ chế và sửa lại</strong>
      {explanation.answer_summary ? <div><b>Đáp án chuẩn</b><p>{String(explanation.answer_summary)}</p></div> : null}
      {explanation.why_correct ? <div><b>Vì sao đúng</b><p>{String(explanation.why_correct)}</p></div> : null}
      {explanation.why_other_answers_fail ? <div><b>Vì sao phương án khác sai</b><p>{String(explanation.why_other_answers_fail)}</p></div> : null}
      {explanation.trap ? <div><b>Bẫy cần tránh</b><p>{String(explanation.trap)}</p></div> : null}
      {explanation.strategy_note ? <div><b>Chiến lược lần sau</b><p>{String(explanation.strategy_note)}</p></div> : null}
      {stage < 5 ? <div className="wex-output">
        <b>Correction output của em</b>
        <label><span>Đáp án sau khi sửa</span><textarea rows={2} maxLength={2000} value={correctedAnswer} onChange={(event) => setCorrectedAnswer(event.target.value)} /></label>
        <label><span>Cơ chế khiến em sai</span><textarea rows={2} maxLength={1000} value={errorMechanism} onChange={(event) => setErrorMechanism(event.target.value)} /></label>
        <label><span>Lần sau em sẽ làm gì khác?</span><textarea rows={2} maxLength={1000} value={nextAction} onChange={(event) => setNextAction(event.target.value)} /></label>
        <button type="button" disabled={Boolean(busy) || !correctedAnswer.trim() || !evidenceAttempt.trim() || !errorMechanism.trim() || !nextAction.trim()} onClick={() => void record('correction_output_submitted', { corrected_answer: correctedAnswer, evidence_response: evidenceAttempt, error_mechanism: errorMechanism, next_action: nextAction })}>{busy === 'correction_output_submitted' ? 'Đang lưu…' : 'Nộp correction output'}</button>
      </div> : <p className="wex-complete" role="status">Đã lưu correction output. Đây chưa phải mastery; hệ thống vẫn cần bài sửa cùng nguồn và transfer/retest.</p>}
      {repair.prompt_vi ? <div className="wex-repair"><b>Bài sửa trên chính nguồn này</b><p>{String(repair.prompt_vi)}</p>{repair.pass_rule ? <small>Điều kiện đạt: {String(repair.pass_rule)}</small> : null}</div> : null}
      {candidateSkills.length ? <div className="wex-candidates"><b>Giả thuyết kỹ năng cần kiểm tra thêm</b><ul>{candidateSkills.map((row: any) => <li key={row.code}><code>{String(row.code)}</code> {String(row.name || '')}</li>)}</ul></div> : null}
    </div> : null}
  </section>;
}
