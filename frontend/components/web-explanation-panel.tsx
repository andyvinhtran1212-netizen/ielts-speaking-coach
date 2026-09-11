'use client';

import { useState } from 'react';

function lines(value: unknown) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return String(value ?? '').split(/\n+|\s+·\s+/).map((row) => row.trim()).filter(Boolean);
}

export function WebExplanationPanel({ object, skill }: {
  object: any;
  skill: 'reading' | 'listening';
}) {
  const explanation = object?.explanation || {};
  const remediation = object?.remediation || {};
  const repair = object?.correction_flow?.same_source_repair || {};
  const evidenceRows = lines(explanation.source_evidence).length
    ? explanation.source_evidence
    : lines(explanation.evidence_location_or_audio_anchor);
  const [evidenceAttempt, setEvidenceAttempt] = useState('');
  const [stage, setStage] = useState<0 | 1 | 2 | 3>(0);
  const candidateSkills = Array.isArray(remediation.candidate_skill_codes)
    ? remediation.candidate_skill_codes.filter((row: any) => row?.code)
    : [];

  return <section className="wex-panel" aria-label="Phương hướng sửa bài mới">
    <header className="wex-panel__head">
      <div><span>WEB EXPLANATION</span><h3>Chữa theo bằng chứng, không chỉ xem đáp án</h3></div>
      <small>{skill === 'reading' ? 'Reading' : 'Listening'} · chẩn đoán đang ở mức đề xuất</small>
    </header>

    <div className="wex-stage">
      <strong>1. Tự chỉ ra bằng chứng trước</strong>
      <p>{skill === 'reading'
        ? 'Ghi đoạn, câu hoặc cụm từ em đã dựa vào khi chọn đáp án.'
        : 'Ghi vị trí audio hoặc cụm em nghe được khi chọn đáp án.'}</p>
      <textarea
        rows={2}
        value={evidenceAttempt}
        onChange={(event) => setEvidenceAttempt(event.target.value)}
        placeholder={skill === 'reading' ? 'Ví dụ: Passage 2, đoạn 4…' : 'Ví dụ: khoảng 12:30, người nữ nói…'}
        disabled={stage > 0}
      />
      {stage === 0 ? <button type="button" disabled={!evidenceAttempt.trim()} onClick={() => setStage(1)}>Chốt bằng chứng của em</button> : null}
    </div>

    {stage >= 1 ? <div className="wex-stage">
      <strong>2. Đối chiếu vị trí nguồn</strong>
      {Array.isArray(evidenceRows) ? <ul>{evidenceRows.map((row: any, index: number) => <li key={`${index}-${String(row?.location || row)}`}>{String(row?.location || row?.quote || row)}</li>)}</ul> : <p>{String(evidenceRows || '')}</p>}
      {stage === 1 ? <button type="button" onClick={() => setStage(2)}>Xem chữ/cụm quyết định</button> : null}
    </div> : null}

    {stage >= 2 ? <div className="wex-stage">
      <strong>3. Chữ hoặc paraphrase quyết định</strong>
      <p>{String(explanation.decisive_word_or_paraphrase || explanation.paraphrase || 'Chưa có gợi ý quyết định.')}</p>
      {stage === 2 ? <button type="button" onClick={() => setStage(3)}>Mở lời giải đầy đủ</button> : null}
    </div> : null}

    {stage >= 3 ? <div className="wex-stage wex-stage--full">
      <strong>4. Hiểu cơ chế và sửa lại</strong>
      {explanation.answer_summary ? <div><b>Đáp án chuẩn</b><p>{String(explanation.answer_summary)}</p></div> : null}
      {explanation.why_correct ? <div><b>Vì sao đúng</b><p>{String(explanation.why_correct)}</p></div> : null}
      {explanation.why_other_answers_fail ? <div><b>Vì sao phương án khác sai</b><p>{String(explanation.why_other_answers_fail)}</p></div> : null}
      {explanation.trap ? <div><b>Bẫy cần tránh</b><p>{String(explanation.trap)}</p></div> : null}
      {explanation.strategy_note ? <div><b>Chiến lược lần sau</b><p>{String(explanation.strategy_note)}</p></div> : null}
      {repair.prompt_vi ? <div className="wex-repair"><b>Bài sửa trên chính nguồn này</b><p>{String(repair.prompt_vi)}</p>{repair.pass_rule ? <small>Điều kiện đạt: {String(repair.pass_rule)}</small> : null}</div> : null}
      {candidateSkills.length ? <div className="wex-candidates"><b>Giả thuyết kỹ năng cần kiểm tra thêm</b><ul>{candidateSkills.map((row: any) => <li key={row.code}><code>{String(row.code)}</code> {String(row.name || '')}</li>)}</ul></div> : null}
    </div> : null}
  </section>;
}
