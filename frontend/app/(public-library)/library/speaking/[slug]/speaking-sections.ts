// Section list of a Speaking question page (LIBRARY-0061 T013, tờ DeSpeaking).
import type { SpeakingDetail } from '../speaking-data';

export type Section = { id: string; label: string };

/** Sections of a question; empty ones are left out, so numbers have no gaps. */
export function speakingSections(q: SpeakingDetail, hasPlayer: boolean): Section[] {
  const cue = q.cue_card;
  const cueFilled = q.part === 2 ? Boolean(cue?.prompt) : Boolean(cue?.questions?.length);
  return [
    cueFilled ? { id: 'the-de', label: q.part === 2 ? 'Thẻ đề' : 'Câu hỏi' } : null,
    hasPlayer ? { id: 'tra-loi-mau', label: q.answer_kind === 'video' ? 'Video trả lời mẫu' : 'Câu trả lời mẫu' } : null,
    { id: 'loi-thoai', label: 'Lời thoại và ghi chú' },
    q.outline.length ? { id: 'dan-y', label: 'Dàn ý trả lời' } : null,
    q.vocabulary.length ? { id: 'tu-vung', label: 'Từ vựng theo chủ đề' } : null,
    q.related_part3.length ? { id: 'part-3', label: 'Câu hỏi Part 3 liên quan' } : null,
    { id: 'luyen-noi', label: 'Luyện nói đề này' },
  ].filter((s): s is Section => s !== null);
}

