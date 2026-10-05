'use client';

import { Fragment, type ReactNode } from 'react';

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

function segment(value: unknown): ReactNode {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map((part, index) => <Fragment key={index}>{index ? ' ' : ''}{segment(part)}</Fragment>);
  const item = record(value);
  if (!item) return null;
  return <>{item.label ? `${item.label}: ` : ''}{item.prefix || item.text || ''}
    {item.q_num != null ? <strong> [Câu {item.q_num}] </strong> : null}
    {item.segments ? segment(item.segments) : null}{item.suffix || ''}{item.example != null ? ` ${item.example} (Example)` : ''}
  </>;
}

/** Read only authored display fields. Never reconstruct a bank from answer keys. */
export function ReviewQuestionContext({ value }: { value: unknown }) {
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
  const instruction = context.instructions || context.instruction || context.word_limit_text || context.word_limit;
  const provenance = record(context.context_provenance);
  const banks = options.length || list(context.paragraph_labels).length;
  return <section className="review-question-context" aria-label="Ngữ cảnh câu hỏi">
    {instruction ? <p>{segment(instruction)}</p> : null}
    {context.max_words != null ? <p>Giới hạn: {context.max_words} từ.</p> : null}
    {banks && (provenance?.options === 'current_content_fallback' || provenance?.paragraph_labels === 'current_content_fallback') ? <p role="status">Nhóm lựa chọn từ đề hiện tại có thể đã thay đổi.</p> : null}
    {options.length ? <div className="review-context-bank"><strong>Nhóm lựa chọn</strong><ul>{options.map((option, index) => <li key={index}>
      {typeof option === 'string' ? option : <><b>{option.label || option.letter || option.id || option.value || ''}</b> {option.text || option.content || ''}</>}
    </li>)}</ul></div> : null}
    {list(context.paragraph_labels).length ? <p>Đoạn: {context.paragraph_labels.join(', ')}</p> : null}
    {image ? <img src={image} alt={imageAlt} loading="lazy" style={{ maxWidth: '100%', height: 'auto' }} /> : null}
    {template ? <div className="review-context-template">
      {template.heading ? <h4>{segment(template.heading)}</h4> : null}
      {template.summary_text ? <p>{template.summary_text}</p> : null}
      {list(template.rows).length ? Array.isArray(template.rows[0]) ? <div style={{ overflowX: 'auto' }}><table>
        {list(template.headers).length ? <thead><tr>{template.headers.map((cell: unknown, index: number) => <th key={index}>{segment(cell)}</th>)}</tr></thead> : null}
        <tbody>{template.rows.map((row: any[], index: number) => <tr key={index}>{row.map((cell, column) => <td key={column}>{segment(cell)}</td>)}</tr>)}</tbody>
      </table></div> : <ul>{template.rows.map((row: unknown, index: number) => <li key={index}>{segment(row)}</li>)}</ul> : null}
      {list(template.groups).map((group, index) => <div key={index}>
        {group.heading || group.heading_segments ? <h5>{group.heading_segments ? segment(group.heading_segments) : segment(group.heading)}</h5> : null}
        <ul>{list(group.items).map((item, itemIndex) => <li key={itemIndex}>{segment(item)}</li>)}</ul>
      </div>)}
      {list(template.steps).length ? <ol>{template.steps.map((step: unknown, index: number) => <li key={index}>{segment(step)}</li>)}</ol> : null}
    </div> : null}
  </section>;
}
