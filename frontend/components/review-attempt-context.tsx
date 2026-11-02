'use client';

import { Fragment, type ReactNode } from 'react';
import { noteTemplateTree } from '@/lib/note-template-tree.mjs';
import { splitNumberedBlanks } from '@/lib/numbered-blank.mjs';

const record = (value: unknown): Record<string, any> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : null;
const list = (value: unknown): any[] => Array.isArray(value) ? value : [];

export function ReviewContextNotice({ value }: { value: unknown }) {
  const source = record(value);
  if (!source) return null;
  const message = source.provenance === 'current_content_fallback' || source.possibly_changed === true
    ? 'Ngữ cảnh đang lấy từ đề hiện tại và có thể khác đề khi bạn làm bài.'
    : source.provenance === 'unavailable' ? 'Chưa khôi phục được ngữ cảnh của lượt làm này.'
      : source.provenance === 'submission_snapshot' ? 'Ngữ cảnh của lượt làm này đã được lưu.'
        : source.provenance === 'verified_original_revision' ? 'Đối chiếu theo phiên bản gốc của lượt làm này.' : null;
  return message ? <p className="review-context-notice" role="status">{message}</p> : null;
}

function numberedBlanks(value: string): ReactNode {
  // `{{n}} ____` is one blank (RV-05); the authored underscores are not repeated.
  return splitNumberedBlanks(value).map((part, index) => typeof part === 'string' ? part
    : <span key={index} className="review-context-blank" aria-label={`Chỗ trống câu ${part.qNum}`}>
      <strong>[Câu {part.qNum}]</strong> ______
    </span>);
}

function segment(value: unknown): ReactNode {
  if (typeof value === 'string' || typeof value === 'number') return numberedBlanks(String(value));
  if (Array.isArray(value)) return value.map((part, index) => <Fragment key={index}>{index ? ' ' : ''}{segment(part)}</Fragment>);
  const item = record(value);
  if (!item) return null;
  return <>{item.label ? segment(`${item.label}: `) : null}{segment(item.prefix || item.text || '')}
    {item.q_num != null ? <strong> [Câu {item.q_num}] </strong> : null}
    {item.segments ? segment(item.segments) : null}{segment(item.suffix || '')}{item.example != null ? segment(` ${item.example} (Example)`) : null}
  </>;
}

function noteItems(items: unknown[]): ReactNode {
  return <ul>{items.map((item, index) => <li key={index}>{segment(item)}
    {list(record(item)?.items).length ? noteItems(list(record(item)?.items)) : null}
  </li>)}</ul>;
}

/** Remove only a serialization that reproduces every authored table cell. */
function tableSummary(template: Record<string, any> | null): { before: unknown; after?: string } {
  const summary = template?.summary_text;
  const headers = list(template?.headers);
  const rows = list(template?.rows);
  if (typeof summary !== 'string' || !headers.length || !rows.length || !rows.every(Array.isArray)) return { before: summary };
  const cellText = (cell: unknown): string | null => typeof cell === 'string' || typeof cell === 'number' ? String(cell)
    : Array.isArray(cell) && cell.every(part => typeof part === 'string' || typeof part === 'number') ? cell.join('; ') : null;
  const cells = [headers, ...rows].map(row => row.map(cellText));
  if (cells.some(row => row.length !== headers.length || row.some(cell => cell === null))) return { before: summary };
  const serialized = [cells[0].join(' | '), headers.map(() => '---').join(' | '), ...cells.slice(1).map(row => row.join(' | '))];
  const normalizeLine = (line: string) => {
    let parts = line.split('|').map(part => part.trim().replace(/\s+/g, ' '));
    // Boundary pipes are optional; an empty first/last authored cell is not.
    if (parts.length === headers.length + 2 && parts[0] === '' && parts.at(-1) === '') parts = parts.slice(1, -1);
    else if (parts.length === headers.length + 1 && parts[0] === '') parts = parts.slice(1);
    else if (parts.length === headers.length + 1 && parts.at(-1) === '') parts = parts.slice(0, -1);
    return parts.length === headers.length && parts.every(part => /^:?-{2,}:?$/.test(part)) ? headers.map(() => '---').join('|') : parts.join('|');
  };
  const tableLines = serialized.join('\n').split(/\r?\n/).map(normalizeLine);
  const summaryLines = summary.split(/\r?\n/);
  const start = summaryLines.findIndex((_, index) => tableLines.every((line, offset) => index + offset < summaryLines.length && normalizeLine(summaryLines[index + offset]) === line));
  return start < 0 ? { before: summary } : {
    before: summaryLines.slice(0, start).join('\n').trim(),
    after: summaryLines.slice(start + tableLines.length).join('\n').trim(),
  };
}

/**
 * Listening mcq_multi stores its question in the instruction (the test player shows only that) and in each
 * prompt; the review card already shows the prompt, so drop instruction lines that only repeat a prompt line.
 */
function instructionWithoutPrompt(instruction: unknown, prompt: unknown): unknown {
  if (typeof instruction !== 'string' || typeof prompt !== 'string') return instruction;
  const normalize = (line: string) => line.replace(/\s+/g, ' ').trim().toLowerCase();
  const promptLines = new Set(prompt.split(/\r?\n/).map(normalize).filter(Boolean));
  const lines = instruction.split(/\r?\n/);
  const kept = lines.filter(line => !promptLines.has(normalize(line)));
  return kept.length === lines.length ? instruction : kept.join('\n').trim();
}

type Choice = { label: string; text: string };

/** Lettered choices the student saw: authored options, else the frozen paragraph openings. */
function labelledChoices(context: Record<string, any> | null): Choice[] {
  const options = Array.isArray(context?.options) ? context.options
    : record(context?.options) ? Object.entries(context!.options).map(([label, text]) => ({ label, text })) : [];
  const authored = options.map((option): Choice | null => {
    const row = record(option);
    const label = row && (row.label ?? row.letter ?? row.id ?? row.value);
    const text = row && (row.text ?? row.content);
    return label != null && typeof text === 'string' && text.trim() ? { label: String(label), text } : null;
  }).filter((choice): choice is Choice => choice !== null);
  if (authored.length) return authored;
  return list(context?.paragraph_previews).map(record)
    .filter((row): row is Record<string, any> => Boolean(row && typeof row.label === 'string' && typeof row.text === 'string' && row.text.trim()))
    .map(row => ({ label: row.label, text: row.text }));
}

/** Resolve an answer such as "B" or "B, D" to its choices; partial matches resolve to nothing. */
export function reviewAnswerChoices(value: unknown, answer: unknown): Choice[] {
  const choices = labelledChoices(record(value));
  const parts = typeof answer === 'string' ? answer.split(/\s*[,;]\s*/).map(part => part.trim()).filter(Boolean) : [];
  if (!choices.length || !parts.length) return [];
  const resolved = parts.map(part => choices.find(choice => choice.label.trim().toLowerCase() === part.toLowerCase()));
  return resolved.every(Boolean) ? resolved as Choice[] : [];
}

/** "B — opening of paragraph B" beside a stored answer letter; the letter itself stays as stored. */
export function ReviewAnswerChoiceText({ context, answer, className = 'rr-card__ans-text' }: { context: unknown; answer: unknown; className?: string }) {
  const choices = reviewAnswerChoices(context, answer);
  if (!choices.length) return null;
  return <span className={className}>{choices.map((choice, index) => <span key={index}>
    {choices.length > 1 ? `${choice.label} — ${choice.text}` : `— ${choice.text}`}
  </span>)}</span>;
}

const UNAVAILABLE_REASONS: Readonly<Record<string, string>> = {
  disabled_by_admin: 'Lời giải chi tiết đang tắt cho bài này theo cài đặt của giáo viên hoặc quản trị viên.',
  waiting_for_admin_result_release: 'Lời giải chi tiết sẽ mở khi kết quả bài thi được công bố.',
  waiting_for_admin_explanation_release: 'Lời giải chi tiết sẽ mở khi giáo viên hoặc quản trị viên công bố lời giải.',
  post_test_capture_required: 'Lời giải chi tiết sẽ mở sau khi bạn hoàn thành phần tự đánh giá sau bài làm.',
  content_release_gates_blocked: 'Lời giải chi tiết của đề này đang được biên tập, chưa phát hành.',
  content_version_unavailable: 'Phiên bản lời giải dành cho bài này chưa sẵn sàng.',
  report_only: 'Bài này chỉ báo cáo kết quả, không có lời giải chi tiết.',
};

/**
 * Why a card has no solution, from the backend's `web_explanation_access`
 * (FR-015 truthful unavailable state). No access object, or an open one
 * (`allowed`, or Listening report_only's `available` key), means only this
 * question lacks a solution; a closed one names the paper-level reason.
 */
export function reviewExplanationUnavailableReason(access: unknown): string {
  const row = record(access);
  if (!row || row.allowed === true || row.available === true) return 'Câu này chưa có lời giải chi tiết.';
  return UNAVAILABLE_REASONS[String(row.reason)] || 'Lời giải chi tiết chưa mở cho bài này.';
}

/** Collapsed-card summary of a paragraph list: letters only, never paragraph text. */
export function ReviewParagraphSummary({ value }: { value: unknown }) {
  const labels = list(record(value)?.paragraph_labels).map(String);
  return labels.length ? <p className="review-context-summary">Đoạn: {labels.join(', ')}</p> : null;
}

/** Read only authored display fields. Never reconstruct a bank from answer keys. */
export function ReviewQuestionContext({ value, prompt }: { value: unknown; prompt?: unknown }) {
  const context = record(value);
  if (!context) return null;
  const options = Array.isArray(context.options) ? context.options
    : record(context.options) ? Object.entries(context.options).map(([label, text]) => ({ label, text })) : [];
  const template = record(context.template);
  // Match the Listening player's inert SVG image path; never insert SVG markup.
  const image = typeof context.map_svg === 'string' && context.map_svg.trim()
    ? `data:image/svg+xml;utf8,${encodeURIComponent(context.map_svg)}`
    : context.map_image_url || context.image_url;
  const imageAlt = context.image_alt || (typeof template?.heading === 'string' && template.heading.trim()) || 'Sơ đồ của câu hỏi';
  const instruction = instructionWithoutPrompt(context.instructions || context.instruction || context.word_limit_text || context.word_limit, prompt);
  const provenance = record(context.context_provenance);
  const banks = options.length || list(context.paragraph_labels).length;
  const paragraphPreviews = new Map(options.length ? [] : labelledChoices(context).map(choice => [choice.label, choice.text]));
  const summary = tableSummary(template);
  const hasTemplateContent = Boolean(template && (template.heading || summary.before || summary.after
    || list(template.rows).length || list(template.steps).length
    || list(template.groups).some(group => group.heading || group.heading_segments || list(group.items).length)));
  if (!instruction && context.max_words == null && !banks && !image && !hasTemplateContent) return null;
  return <section className="review-question-context" aria-label="Ngữ cảnh câu hỏi">
    {instruction ? <p>{segment(instruction)}</p> : null}
    {context.max_words != null ? <p>Giới hạn: {context.max_words} từ.</p> : null}
    {banks && (provenance?.options === 'current_content_fallback' || provenance?.paragraph_labels === 'current_content_fallback') ? <p role="status">Nhóm lựa chọn từ đề hiện tại có thể đã thay đổi.</p> : null}
    {options.length ? <div className="review-context-bank"><strong>Nhóm lựa chọn</strong><ul>{options.map((option, index) => <li key={index}>
      {typeof option === 'string' ? option : <><b>{option.label || option.letter || option.id || option.value || ''}</b> {option.text || option.content || ''}</>}
    </li>)}</ul></div> : null}
    {list(context.paragraph_labels).length ? paragraphPreviews.size ? <div className="review-context-bank"><strong>Đoạn</strong><ul>
      {context.paragraph_labels.map((label: unknown, index: number) => <li key={index}><b>{String(label)}</b> {paragraphPreviews.get(String(label)) || ''}</li>)}
    </ul></div> : <p>Đoạn: {context.paragraph_labels.join(', ')}</p> : null}
    {image ? <img src={image} alt={imageAlt} loading="lazy" style={{ maxWidth: '100%', height: 'auto' }} /> : null}
    {template ? <div className="review-context-template">
      {template.heading ? <h4>{segment(template.heading)}</h4> : null}
      {summary.before ? <p style={{ whiteSpace: 'pre-wrap' }}>{segment(summary.before)}</p> : null}
      {list(template.rows).length ? Array.isArray(template.rows[0]) ? <div style={{ overflowX: 'auto' }}><table>
        {list(template.headers).length ? <thead><tr>{template.headers.map((cell: unknown, index: number) => <th scope="col" key={index}>{segment(cell)}</th>)}</tr></thead> : null}
        <tbody>{template.rows.map((row: any[], index: number) => <tr key={index}>{row.map((cell, column) => <td key={column}>{segment(cell)}</td>)}</tr>)}</tbody>
      </table></div> : <ul>{template.rows.map((row: unknown, index: number) => <li key={index}>{segment(row)}</li>)}</ul> : null}
      {summary.after ? <p style={{ whiteSpace: 'pre-wrap' }}>{segment(summary.after)}</p> : null}
      {list(template.groups).map((group, index) => <div key={index}>
        {group.heading || group.heading_segments ? <h5>{group.heading_segments ? segment(group.heading_segments) : segment(group.heading)}</h5> : null}
        {noteItems(noteTemplateTree(list(group.items)))}
      </div>)}
      {list(template.steps).length ? <ol>{template.steps.map((step: unknown, index: number) => <li key={index}>{segment(step)}</li>)}</ol> : null}
    </div> : null}
  </section>;
}
