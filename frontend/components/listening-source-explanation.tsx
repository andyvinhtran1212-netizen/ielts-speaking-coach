import type { ListeningSourceExplanationWire } from '@/lib/listening-source-collection-api';
import { sourceAnswerProvenanceLabel, sourceEvidenceLabel, sourcePrintedKeyLabel, sourceReviewLabel } from '@/lib/listening-source-collection-api';

export function ListeningSourceExplanation({ explanation, reviewStatus, provenance }: { explanation: ListeningSourceExplanationWire; reviewStatus?: string | null; provenance?: string | null }) {
  const formatAnswer = (value: ListeningSourceExplanationWire['answer']) => Array.isArray(value) ? value.join(' · ') : value && typeof value === 'object' ? Object.entries(value).map(([label, text]) => `${label}: ${text}`).join(' · ') : value;
  const answer = formatAnswer(explanation.answer);
  const printedAnswer = formatAnswer(explanation.printed_key?.answer);
  const printedKey = explanation.printed_key;
  const keyCitations = printedKey?.source_lines?.length ? printedKey.source_lines.map((line) => `PDF trang ${line.pdf_page}, dòng ${line.line_index_1_based}`) : printedKey?.source_pdf_page != null ? [`PDF trang ${printedKey.source_pdf_page}${printedKey.source_ocr_line_index_1_based != null ? `, dòng ${printedKey.source_ocr_line_index_1_based}` : ''}`] : [];
  return <section className="source-explanation" aria-label="Lời giải có bằng chứng">
    <header><h3>Lời giải</h3>{reviewStatus ? <span className="source-badge">{sourceReviewLabel(reviewStatus)}</span> : null}</header>
    {answer ? <p><strong>Đáp án tham khảo:</strong> {answer}</p> : null}
    {printedAnswer ? <p><strong>{sourcePrintedKeyLabel(printedKey?.evidence_tier)}:</strong> {printedAnswer}{keyCitations.length ? <small> · {keyCitations.join(' · ')}</small> : null}</p> : null}
    {provenance ? <p className="source-explanation__provenance">Nguồn đáp án: {sourceAnswerProvenanceLabel(provenance)}</p> : null}
    {explanation.source_answer_warning_vi ? <p className="source-notice" role="note">{explanation.source_answer_warning_vi}</p> : null}
    {explanation.evidence?.length ? <div><h4>Bằng chứng</h4>{explanation.evidence.map((evidence, index) => <blockquote key={index}><p lang="en">{evidence.quote}</p><cite>{sourceEvidenceLabel(evidence.source_kind)}{evidence.pdf_page != null ? ` · PDF trang ${evidence.pdf_page}` : ''}{evidence.line_index_1_based != null ? `, dòng ${evidence.line_index_1_based}` : ''}{evidence.visual_reconstruction ? ' · Đã đối chiếu chữ trên ảnh trang gốc' : ''}</cite></blockquote>)}</div> : null}
    <div><h4>Vì sao chọn đáp án này?</h4><p>{explanation.why_vi}</p></div>
    {explanation.distractors?.length ? <details><summary>Đối chiếu các phương án còn lại</summary><ul>{explanation.distractors.map((option) => <li key={option.option}><strong>{option.text || option.option}:</strong> {option.reason_vi}</li>)}</ul></details> : null}
    {explanation.paraphrase_vi ? <p><strong>Cách diễn đạt tương đương:</strong> {explanation.paraphrase_vi}</p> : null}
    {explanation.trap_vi ? <p><strong>Bẫy nghe:</strong> {explanation.trap_vi}</p> : null}
    {explanation.format_vi ? <p><strong>Cách ghi đáp án:</strong> {explanation.format_vi}</p> : null}
    {explanation.next_action_vi ? <p className="source-notice">{explanation.next_action_vi}</p> : null}
  </section>;
}
