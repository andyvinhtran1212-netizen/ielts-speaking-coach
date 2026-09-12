'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { answerOptions, candidateErrorOptions } from '@/lib/web-explanation-model.mjs';

type Skill = 'reading' | 'listening';
type EventName = 'correction_result_seen' | 'evidence_attempt_submitted'
  | 'hint_revealed'
  | 'full_explanation_opened' | 'correction_output_submitted';

export type EvidenceSelection = {
  kind: 'reading_text' | 'audio_timestamp' | 'not_found';
  response: string;
  locator: Record<string, unknown>;
};

type EvidenceRow = {
  location: string;
  quote: string;
  relation: string;
  timestamp: string;
};

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

const NEXT_ACTIONS: Record<Skill, Array<[string, string]>> = {
  reading: [
    ['locate_first', 'Định vị câu chứa từ khóa trước khi chọn'],
    ['compare_claim', 'So từng phần của claim với bằng chứng'],
    ['check_paraphrase', 'Gạch cặp paraphrase quyết định'],
    ['check_form', 'Kiểm tra giới hạn từ và dạng ngữ pháp'],
  ],
  listening: [
    ['follow_cue', 'Bám cue/signpost trước chỗ cần nghe'],
    ['wait_correction', 'Chờ người nói chốt sau self-correction'],
    ['note_chunk', 'Ghi lại đúng cụm nghe được rồi mới chọn'],
    ['check_form', 'Kiểm tra chính tả và dạng đáp án'],
  ],
};

const INTERNAL_LABELS: Record<string, string> = {
  distractor_drop: 'phương án nhiễu',
  mcq_distractor_drop: 'phương án nhiễu trong trắc nghiệm',
  paraphrase_t0: 'paraphrase gần mặt chữ',
  paraphrase_t1: 'paraphrase đổi cách diễn đạt',
  paraphrase_t2: 'paraphrase đổi cấu trúc hoặc ý',
  paraphrase_t3: 'paraphrase cần suy luận',
  polarity_flip: 'đảo nghĩa khẳng định / phủ định',
  map_double_constraint: 'hai điều kiện vị trí',
  plural_spelling: 'số nhiều hoặc chính tả',
  number_magnitude: 'độ lớn của số',
  name_spelling: 'đánh vần tên riêng',
  number_correction: 'số được người nói sửa lại',
  self_correction: 'người nói tự sửa',
  synonym_chain: 'chuỗi từ đồng nghĩa',
  definition_vs_example: 'nhầm định nghĩa với ví dụ',
  lever_stacked: 'nhiều dấu hiệu cùng quyết định',
  hedged_hypothesis: 'ý kiến có mức độ dè dặt',
};

function clean(value: unknown) {
  let text = String(value ?? '').replace(/```/g, '');
  for (const [code, label] of Object.entries(INTERNAL_LABELS)) {
    text = text.replaceAll(`\`${code}\``, label);
  }
  return text
    .normalize('NFC')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/\\n/g, '\n')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/(^|\n)#{1,6}\s+/g, '$1')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, '&')
    .replace(/\*\*Re-listen anchor:\*\*/gi, '**Mốc nghe lại:**')
    .replace(/\bspeaker\s+/gi, 'người nói ')
    .replace(/\s+---+\s*$/g, '')
    .trim();
}

function inlineNodes(value: unknown): ReactNode[] {
  return clean(value).split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*\n]+\*)/g).filter(Boolean)
    .map((part, index) => {
      if (part.startsWith('`') && part.endsWith('`')) {
        return <code className="wex-code" key={`${index}-${part}`}>{part.slice(1, -1)}</code>;
      }
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={`${index}-${part}`}>{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith('*') && part.endsWith('*')) {
        return <em key={`${index}-${part}`}>{part.slice(1, -1)}</em>;
      }
      return <span key={`${index}-${part}`}>{part}</span>;
    });
}

function proseRows(value: unknown) {
  return clean(value).split(/\n+|\s+·\s+/).map((row) => row.trim().replace(/^[-•]\s*/, '')).filter(Boolean);
}

function Prose({ value }: { value: unknown }) {
  const rows = proseRows(value);
  if (!rows.length) return null;
  return rows.length === 1
    ? <p>{inlineNodes(rows[0])}</p>
    : <ul className="wex-list">{rows.map((row, index) => <li key={`${index}-${row}`}>{inlineNodes(row)}</li>)}</ul>;
}

function clock(raw: number) {
  const seconds = Math.max(0, Math.floor(raw || 0));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function readableTimestamp(value: unknown) {
  const raw = clean(value);
  const match = raw.match(/^(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)s?$/i);
  return match ? `${clock(Number(match[1]))}–${clock(Number(match[2]))}` : raw;
}

function evidenceRows(value: unknown): EvidenceRow[] {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.map((row) => {
    if (row && typeof row === 'object') {
      const item = row as Record<string, unknown>;
      const start = Number(item.start_seconds);
      const end = Number(item.end_seconds);
      return {
        location: clean(item.location).replace(/;\s*[^;]*(?:\.md|\.json)\b.*$/i, ''),
        quote: clean(item.quote),
        relation: /token containment|authored_solution|deterministic/i.test(clean(item.relation)) ? '' : clean(item.relation),
        timestamp: readableTimestamp(item.timestamp) || (Number.isFinite(start) && Number.isFinite(end)
          ? `${clock(start)}–${clock(end)}` : ''),
      };
    }
    return { location: clean(row), quote: '', relation: '', timestamp: '' };
  }).filter((row) => row.location || row.quote || row.relation || row.timestamp);
}

function EvidenceCards({ rows }: { rows: EvidenceRow[] }) {
  if (!rows.length) return <p>Chưa có vị trí nguồn đã duyệt.</p>;
  return <div className="wex-evidence-cards">{rows.map((row, index) => <article className="wex-evidence" key={`${index}-${row.location}-${row.timestamp}`}>
    <div className="wex-evidence__meta">{row.timestamp ? <span><b>Audio</b>{row.timestamp}</span> : null}{row.location ? <span><b>Nguồn</b>{row.location}</span> : null}</div>
    {row.quote ? <blockquote>{inlineNodes(row.quote)}</blockquote> : null}
    {row.relation ? <p className="wex-evidence__relation">{inlineNodes(row.relation)}</p> : null}
  </article>)}</div>;
}

export function WebExplanationPanel({
  object,
  skill,
  attemptId,
  questionNumber,
  persistenceEnabled = true,
  evidenceSelection = null,
  onStartReadingSelection,
  onReplayAudio,
  getAudioPosition,
  correctionRequired = true,
}: {
  object: any;
  skill: Skill;
  attemptId: string | null;
  questionNumber: number;
  persistenceEnabled?: boolean;
  evidenceSelection?: EvidenceSelection | null;
  onStartReadingSelection?: () => void;
  onReplayAudio?: () => void;
  getAudioPosition?: () => number | null;
  correctionRequired?: boolean;
}) {
  const explanation = object?.explanation || {};
  const repair = object?.correction_flow?.same_source_repair || {};
  const sourceRows = useMemo(() => {
    const source = evidenceRows(explanation.source_evidence);
    return source.length ? source : evidenceRows(explanation.evidence_location_or_audio_anchor);
  }, [explanation.evidence_location_or_audio_anchor, explanation.source_evidence]);
  const choices = useMemo(
    () => answerOptions(object, clean) as Array<[string, string]>,
    [object],
  );
  const errorChoices = useMemo(
    () => candidateErrorOptions(object, clean) as Array<[string, string]>,
    [object],
  );
  const [localEvidence, setLocalEvidence] = useState<EvidenceSelection | null>(evidenceSelection);
  const [correctedAnswer, setCorrectedAnswer] = useState('');
  const [errorMechanism, setErrorMechanism] = useState('');
  const [nextAction, setNextAction] = useState('');
  const [stage, setStage] = useState(correctionRequired ? 0 : 4);
  const [busy, setBusy] = useState<EventName | ''>('');
  const [error, setError] = useState('');
  const eventIds = useRef<Partial<Record<EventName, string>>>({});
  const canPersist = persistenceEnabled && Boolean(attemptId) && Number.isInteger(questionNumber);

  useEffect(() => {
    if (stage === 0 && evidenceSelection) setLocalEvidence(evidenceSelection);
  }, [evidenceSelection, stage]);

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
        { event_id: eventId, event_name: eventName, client_occurred_at: new Date().toISOString(), client_version: 'web-review/1.1', payload },
      );
      if (!response?.state || STATE_STAGE[response.state] === undefined) throw new Error('Backend không trả lại correction state hợp lệ.');
      setStage(STATE_STAGE[response.state]);
      if (response.evidence_response) {
        setLocalEvidence((current) => current || {
          kind: 'not_found', response: response.evidence_response!, locator: { kind: 'restored' },
        });
      }
      delete eventIds.current[eventName];
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught || 'Không ghi được tiến trình sửa bài.'));
      return false;
    } finally {
      setBusy('');
    }
  }, [attemptId, canPersist, questionNumber, skill]);

  useEffect(() => {
    if (correctionRequired) void record('correction_result_seen');
  }, [correctionRequired, record]);

  const markAudioPosition = () => {
    const seconds = getAudioPosition?.();
    if (seconds == null || !Number.isFinite(seconds)) {
      setError('Hãy phát audio và dừng tại cụm quyết định trước khi đánh dấu.');
      return;
    }
    setError('');
    setLocalEvidence({
      kind: 'audio_timestamp',
      response: `Mốc audio ${clock(seconds)}`,
      locator: { kind: 'audio_timestamp', seconds: Number(seconds.toFixed(2)) },
    });
  };

  const submitEvidence = () => {
    if (!localEvidence) return;
    void record('evidence_attempt_submitted', {
      evidence_response: localEvidence.response,
      evidence_selection: localEvidence.locator,
    });
  };

  const markNotFound = () => setLocalEvidence({
    kind: 'not_found',
    response: 'Chưa xác định được bằng chứng trước gợi ý.',
    locator: { kind: 'not_found' },
  });

  const submitCorrection = () => {
    if (!localEvidence) return;
    const errorLabel = errorChoices.find(([code]) => code === errorMechanism)?.[1] || errorMechanism;
    const actionLabel = NEXT_ACTIONS[skill].find(([code]) => code === nextAction)?.[1] || nextAction;
    void record('correction_output_submitted', {
      corrected_answer: correctedAnswer,
      evidence_response: localEvidence.response,
      evidence_selection: localEvidence.locator,
      error_mechanism: errorLabel,
      error_mechanism_code: errorMechanism,
      next_action: actionLabel,
      next_action_code: nextAction,
    });
  };

  return <section className="wex-panel" aria-label="Phương hướng sửa bài">
    <header className="wex-panel__head">
      <div><span>{correctionRequired ? 'CHỮA BÀI CÓ HƯỚNG DẪN' : 'ĐỐI CHIẾU NHANH'}</span><h3>{correctionRequired ? 'Tìm bằng chứng, thử lại, rồi mới mở lời giải' : 'Bạn đã làm đúng — xem vì sao đáp án khớp'}</h3></div>
      <small>{skill === 'reading' ? 'Reading' : 'Listening'} · {!correctionRequired ? 'câu đúng' : stage >= 5 ? 'đã lưu bài sửa' : `bước ${Math.min(stage + 1, 5)} trên 5`}</small>
    </header>

    {correctionRequired ? <ol className="wex-progress" aria-label="Tiến trình sửa bài">
      {['Bằng chứng', 'Đúng vùng', 'Từ quyết định', 'Thử lại', 'Đối chiếu'].map((label, index) => <li
        className={`${stage === index ? 'is-current' : ''}${stage > index ? ' is-complete' : ''}`.trim()}
        aria-current={stage === index ? 'step' : undefined}
        key={label}
      ><span>{stage > index ? '✓' : index + 1}</span><small>{label}</small></li>)}
    </ol> : null}

    {error ? <div className="wex-alert" role="alert"><span>{error}</span><button type="button" onClick={() => setError('')}>Đóng</button></div> : null}

    {correctionRequired ? <><div className={`wex-stage${stage === 0 ? ' is-current' : ' is-complete'}`} aria-current={stage === 0 ? 'step' : undefined}>
      <div className="wex-stage__title"><span>1</span><strong>Tự tìm bằng chứng</strong></div>
      {stage === 0 ? <>
        <p>{skill === 'reading'
          ? 'Bôi chọn 1–3 câu trong bài đọc. Hệ thống sẽ lưu vị trí và đoạn bạn chọn, không cần gõ lại.'
          : 'Nghe lại đoạn của câu này, dừng tại cụm quyết định rồi đánh dấu mốc đang nghe.'}</p>
        <div className="wex-evidence-actions">
          {skill === 'reading'
            ? <button type="button" className="av-button av-button-secondary" onClick={onStartReadingSelection}>Bôi chọn trong bài đọc</button>
            : <><button type="button" className="av-button av-button-secondary" onClick={onReplayAudio}>Nghe đoạn câu này</button><button type="button" className="av-button av-button-secondary" onClick={markAudioPosition}>Đánh dấu mốc đang nghe</button></>}
          <button type="button" className="av-button av-button-tertiary" onClick={markNotFound}>Tôi chưa tìm được</button>
        </div>
        {localEvidence ? <div className="wex-selection" role="status"><span>Bằng chứng bạn chọn</span><p>{localEvidence.response}</p></div> : null}
        <button type="button" className="av-button av-button-primary" disabled={!localEvidence || Boolean(busy)} onClick={submitEvidence}>{busy === 'evidence_attempt_submitted' ? 'Đang lưu…' : 'Chốt và tiếp tục'}</button>
      </> : <div className="wex-stage__done"><span>Đã ghi nhận trước khi mở gợi ý</span>{localEvidence ? <q>{localEvidence.response}</q> : null}</div>}
    </div>

    {stage >= 1 ? <div className={`wex-stage${stage === 1 ? ' is-current' : ' is-complete'}`} aria-current={stage === 1 ? 'step' : undefined}>
      <div className="wex-stage__title"><span>2</span><strong>Kiểm tra đúng vùng nguồn</strong></div>
      {stage === 1
        ? <><p>Chỉ mở vị trí tổng quát; đáp án và cụm quyết định vẫn được giữ kín.</p><button type="button" className="av-button av-button-primary" disabled={Boolean(busy)} onClick={() => void record('hint_revealed', { hint_type: 'location' })}>{busy === 'hint_revealed' ? 'Đang lưu…' : 'Xem vị trí nguồn'}</button></>
        : <EvidenceCards rows={sourceRows.map((row) => ({ ...row, quote: '', relation: '' }))} />}
    </div> : null}

    {stage >= 2 ? <div className={`wex-stage${stage === 2 ? ' is-current' : ' is-complete'}`} aria-current={stage === 2 ? 'step' : undefined}>
      <div className="wex-stage__title"><span>3</span><strong>Nhận ra chữ hoặc paraphrase quyết định</strong></div>
      {stage === 2 ? <button type="button" className="av-button av-button-primary" disabled={Boolean(busy)} onClick={() => void record('hint_revealed', { hint_type: 'decisive' })}>{busy === 'hint_revealed' ? 'Đang lưu…' : 'Mở gợi ý quyết định'}</button> : <Prose value={explanation.decisive_word_or_paraphrase || explanation.paraphrase || 'Chưa có gợi ý quyết định.'} />}
    </div> : null}

    {stage >= 3 ? <div className={`wex-stage${stage === 3 ? ' is-current' : ' is-complete'}`} aria-current={stage === 3 ? 'step' : undefined}>
      <div className="wex-stage__title"><span>4</span><strong>Thử lại trước khi xem lời giải</strong></div>
      <p>Chốt lại đáp án trong đầu hoặc trên giấy. Khi sẵn sàng, mở lời giải để đối chiếu.</p>
      {stage === 3 ? <button type="button" className="av-button av-button-primary" disabled={Boolean(busy)} onClick={() => void record('full_explanation_opened')}>{busy === 'full_explanation_opened' ? 'Đang lưu…' : 'Mở lời giải đầy đủ'}</button> : <p className="wex-stage__done">Đã thử lại trước khi đối chiếu đáp án.</p>}
    </div> : null}</> : null}

    {stage >= 4 ? <div className="wex-stage wex-stage--full is-current" aria-current="step">
      <div className="wex-stage__title"><span>{correctionRequired ? '5' : '✓'}</span><strong>{correctionRequired ? 'Đối chiếu và tạo bài sửa ngắn' : 'Đối chiếu lời giải'}</strong></div>
      <div className="wex-answer"><span>Đáp án chuẩn</span><Prose value={explanation.answer_summary || object?.item?.answer?.canonical} /></div>
      <details open><summary>Bằng chứng nguồn</summary><EvidenceCards rows={sourceRows} />{explanation.script_extract ? <blockquote className="wex-script">{inlineNodes(explanation.script_extract)}</blockquote> : null}</details>
      {explanation.why_correct || explanation.decision_path ? <details open><summary>Vì sao đúng</summary><Prose value={explanation.why_correct || explanation.decision_path} /></details> : null}
      {explanation.why_other_answers_fail ? <details><summary>Vì sao phương án khác sai</summary><Prose value={explanation.why_other_answers_fail} /></details> : null}
      {explanation.paraphrase ? <details><summary>Paraphrase</summary><Prose value={explanation.paraphrase} /></details> : null}
      {explanation.trap ? <details><summary>Bẫy cần tránh</summary><Prose value={explanation.trap} /></details> : null}
      {explanation.vocabulary || explanation.marking_note ? <details><summary>Từ vựng và lưu ý chấm</summary><Prose value={explanation.vocabulary} /><Prose value={explanation.marking_note} /></details> : null}
      {!correctionRequired ? <p className="wex-complete" role="status">✓ Bạn đã làm đúng câu này. Chỉ cần đối chiếu bằng chứng; hệ thống không yêu cầu nhập thêm bài sửa.</p> : stage < 5 ? <div className="wex-output">
        <div><b>Bài sửa của bạn</b><small>Bằng chứng đã được điền từ bước 1; bạn chỉ cần chốt ba lựa chọn ngắn.</small></div>
        <label><span>Đáp án sau khi sửa</span>{choices.length
          ? <select value={correctedAnswer} onChange={(event) => setCorrectedAnswer(event.target.value)}><option value="">Chọn đáp án</option>{choices.map(([value, label]) => <option value={value} key={value}>{value}. {label}</option>)}</select>
          : <input maxLength={2000} value={correctedAnswer} onChange={(event) => setCorrectedAnswer(event.target.value)} placeholder="Nhập đáp án ngắn" />}</label>
        <label><span>Bạn sai chủ yếu vì</span><select value={errorMechanism} onChange={(event) => setErrorMechanism(event.target.value)}><option value="">Chọn một lý do</option>{errorChoices.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label><span>Lần sau bạn sẽ</span><select value={nextAction} onChange={(event) => setNextAction(event.target.value)}><option value="">Chọn một hành động</option>{NEXT_ACTIONS[skill].map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <button type="button" className="av-button av-button-primary" disabled={Boolean(busy) || !correctedAnswer.trim() || !localEvidence || !errorMechanism || !nextAction} onClick={submitCorrection}>{busy === 'correction_output_submitted' ? 'Đang lưu…' : 'Lưu bài sửa'}</button>
      </div> : <p className="wex-complete" role="status">✓ Đã lưu bài sửa. Mở lời giải chưa đồng nghĩa đã thành thạo; hệ thống sẽ dùng bài sửa và lần luyện sau để kiểm tra tiến bộ.</p>}
      {repair.prompt_vi ? <div className="wex-repair"><b>Bài kiểm tra hiểu ngay trên nguồn này</b><Prose value={repair.prompt_vi} />{repair.pass_rule ? <small>Điều kiện đạt: {clean(repair.pass_rule)}</small> : null}</div> : null}
    </div> : null}
  </section>;
}
