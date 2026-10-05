'use client';

import { useId, useRef, useState } from 'react';
import type { ListeningSourceBlockWire } from '@/lib/listening-source-collection-api';

type SourceImage = Pick<NonNullable<ListeningSourceBlockWire['images']>[number], 'asset_id' | 'url' | 'width' | 'height' | 'alt_vi'>;
type NativePresentation = NonNullable<ListeningSourceBlockWire['native']>;

function NativeContent({ native, showQuestions }: { native: NativePresentation; showQuestions: boolean }) {
  return <div className="source-native">
    {native.title ? <h3>{native.title}</h3> : null}
    {native.text ? <div className="source-native__text" lang="en">{native.text}</div> : null}
    {native.rows?.length ? <div className="source-native__table" role="region" tabIndex={0} aria-label={native.title || 'Bảng câu hỏi, có thể cuộn ngang'}><table>{native.columns?.length ? <thead><tr>{native.columns.map((column, index) => <th scope="col" key={index}>{column}</th>)}</tr></thead> : null}<tbody>{native.rows.map((cells, row) => <tr key={row}>{cells.map((cell, column) => <td key={column}>{cell}</td>)}</tr>)}</tbody></table></div> : null}
    {native.word_bank?.length ? <ul className="source-native__pool" aria-label="Danh sách lựa chọn dùng chung">{native.word_bank.map((word, index) => <li key={index}>{word}</li>)}</ul> : null}
    {native.figures?.map((figure) => <QuestionImage key={figure.figure_id} image={{ asset_id: figure.figure_id, url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(figure.svg)}`, width: figure.width, height: figure.height, alt_vi: figure.alt_vi }} />)}
    {showQuestions && native.questions?.length ? <ol className="source-native__questions">{native.questions.map((question) => <li key={question.item_id}><p><strong>Câu {question.source_display_number}</strong> · {question.prompt}</p>{question.options?.length ? <ul>{question.options.map((option) => <li key={option.id}><strong>{option.id}</strong> · {option.label}</li>)}</ul> : null}{question.fields?.length ? <ul>{question.fields.map((field) => <li key={field.field_id}>{field.prompt}{field.word_limit ? ` (Tối đa ${field.word_limit} từ)` : ''}</li>)}</ul> : null}</li>)}</ol> : null}
  </div>;
}

function QuestionImage({ image }: { image: SourceImage }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const [zoom, setZoom] = useState(100);
  const [failed, setFailed] = useState(false);
  return <figure className="source-image">
    {failed ? <div className="source-notice is-error" role="alert"><p>Chưa tải được hình đề. Hãy tải lại để lấy liên kết mới.</p><button type="button" onClick={() => window.location.reload()}>Tải lại ảnh</button></div> : <>
      <button type="button" className="source-image__open" onClick={() => { setZoom(100); dialog.current?.showModal(); }} aria-label={`Phóng to ảnh đề: ${image.alt_vi}`}>
        <img src={image.url} width={image.width} height={image.height} alt={image.alt_vi} onError={() => setFailed(true)} />
      </button>
      <figcaption><button type="button" onClick={() => { setZoom(100); dialog.current?.showModal(); }}>Phóng to ảnh đề</button><span>Có thể cuộn ảnh và dùng phím mũi tên khi phóng to.</span></figcaption>
      <dialog ref={dialog} className="source-image-dialog" aria-labelledby={headingId}>
        <header><h2 id={headingId}>Hình vẽ lại từ đề gốc</h2><button type="button" onClick={() => dialog.current?.close()}>Đóng</button></header>
        <label className="source-image-dialog__zoom">Độ phóng đại {zoom}%<input type="range" min="100" max="250" step="25" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label>
        <div className="source-image-dialog__viewport" tabIndex={0} role="region" aria-label="Ảnh đề có thể cuộn ngang và dọc"><img src={image.url} alt={image.alt_vi} style={{ width: `${zoom}%`, maxWidth: 'none' }} /></div>
        <p>{image.alt_vi}</p>
      </dialog>
    </>}
  </figure>;
}

export function ListeningSourceBlock({ block, showQuestions = true }: { block: ListeningSourceBlockWire; showQuestions?: boolean }) {
  const instruction = block.instruction;
  return <section className="source-block" aria-label={block.source_question_numbers?.length ? `Khối câu hỏi ${block.source_question_numbers.join(', ')}` : 'Tài liệu nguồn'}>
    {instruction.source_en ? <p className="source-block__original" lang="en">{instruction.source_en}</p> : null}
    {instruction.student_vi ? <p className="source-block__instruction">{instruction.student_vi}</p> : null}
    {instruction.word_limit != null ? <p className="source-block__limit">Giới hạn: {instruction.word_limit} từ theo hướng dẫn nguồn.</p> : null}
    {instruction.select_count != null ? <p className="source-block__limit">Chọn {instruction.select_count} phương án theo hướng dẫn nguồn.</p> : null}
    {block.native ? <NativeContent native={block.native} showQuestions={showQuestions} /> : <p className="source-notice is-error" role="alert">Chưa có bản trình bày chữ và hình của đề này. Hãy tải lại hoặc thử lại sau.</p>}
    {block.description ? <details className="source-block__text"><summary>{block.display_kind === 'source_study' ? 'Ghi chú tài liệu bằng tiếng Việt' : 'Mô tả đề bằng chữ'}</summary><p>{block.description}</p></details> : null}
  </section>;
}
