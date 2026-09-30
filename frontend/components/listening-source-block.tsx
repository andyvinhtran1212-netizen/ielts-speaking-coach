'use client';

import { useId, useRef, useState } from 'react';
import type { ListeningSourceBlockWire } from '@/lib/listening-source-collection-api';

type SourceImage = NonNullable<ListeningSourceBlockWire['images']>[number];

function QuestionImage({ image }: { image: SourceImage }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const [zoom, setZoom] = useState(100);
  const [failed, setFailed] = useState(false);
  return <figure className="source-image">
    {failed ? <div className="source-notice is-error" role="alert"><p>Chưa tải được ảnh đề. Hãy tải lại để lấy liên kết mới.</p><button type="button" onClick={() => window.location.reload()}>Tải lại ảnh</button></div> : <>
      <button type="button" className="source-image__open" onClick={() => { setZoom(100); dialog.current?.showModal(); }} aria-label={`Phóng to ảnh đề: ${image.alt_vi}`}>
        <img src={image.url} width={image.width} height={image.height} alt={image.alt_vi} onError={() => setFailed(true)} />
      </button>
      <figcaption><button type="button" onClick={() => { setZoom(100); dialog.current?.showModal(); }}>Phóng to ảnh đề</button><span>Có thể cuộn ảnh và dùng phím mũi tên khi phóng to.</span></figcaption>
      <dialog ref={dialog} className="source-image-dialog" aria-labelledby={headingId}>
        <header><h2 id={headingId}>Ảnh đề gốc</h2><button type="button" onClick={() => dialog.current?.close()}>Đóng</button></header>
        <label className="source-image-dialog__zoom">Độ phóng đại {zoom}%<input type="range" min="100" max="250" step="25" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label>
        <div className="source-image-dialog__viewport" tabIndex={0} role="region" aria-label="Ảnh đề có thể cuộn ngang và dọc"><img src={image.url} alt={image.alt_vi} style={{ width: `${zoom}%`, maxWidth: 'none' }} /></div>
        <p>{image.alt_vi}</p>
      </dialog>
    </>}
  </figure>;
}

export function ListeningSourceBlock({ block }: { block: ListeningSourceBlockWire }) {
  const instruction = block.instruction;
  return <section className="source-block" aria-label={block.source_question_numbers?.length ? `Khối câu hỏi ${block.source_question_numbers.join(', ')}` : 'Tài liệu nguồn'}>
    {instruction.source_en ? <p className="source-block__original" lang="en">{instruction.source_en}</p> : null}
    {instruction.student_vi ? <p className="source-block__instruction">{instruction.student_vi}</p> : null}
    {instruction.word_limit != null ? <p className="source-block__limit">Giới hạn: {instruction.word_limit} từ theo hướng dẫn nguồn.</p> : null}
    {instruction.select_count != null ? <p className="source-block__limit">Chọn {instruction.select_count} phương án theo hướng dẫn nguồn.</p> : null}
    {(block.images || []).map((image) => <QuestionImage image={image} key={image.asset_id} />)}
    {block.description ? <details className="source-block__text"><summary>{block.display_kind === 'source_study' ? 'Ghi chú tài liệu bằng tiếng Việt' : 'Mô tả đề bằng chữ'}</summary><p>{block.description}</p></details> : null}
  </section>;
}
