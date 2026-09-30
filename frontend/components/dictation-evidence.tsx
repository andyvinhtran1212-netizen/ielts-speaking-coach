import { dictationDisplaySegments, LEXICAL_DICTATION_POLICY } from '@/lib/listening-dictation-controller.mjs';

// The server owns lexical alignment. Unicode offsets are validated by the
// controller with Array.from; rendering never tokenizes or recalculates scores.
export function DictationRawText({ grade, side }: { grade: any; side: 'reference' | 'user' }) {
  const segments = dictationDisplaySegments(grade, side);
  return <span className="dict-next-diff" data-dictation-side={side} style={{ whiteSpace: 'pre-wrap' }}>{segments.map((segment: any, index: number) => {
    const unscored = segment.kind === 'unscored';
    const neutral = unscored || segment.filler;
    const title = unscored ? 'Dấu hoặc ký hiệu hiển thị · không tính điểm'
      : segment.filler ? 'Từ ngập ngừng · không trừ điểm'
        : segment.op === 'miss' ? 'Thiếu từ' : segment.op === 'wrong' ? 'Sai từ' : segment.op === 'extra' ? 'Thừa từ' : undefined;
    return <span key={index} data-kind={segment.kind} data-op={segment.op || undefined}
      className={neutral ? 'is-filler' : segment.op ? `is-${segment.op}` : undefined}
      style={{ color: neutral ? 'var(--av-text-muted)' : ['miss', 'wrong', 'extra'].includes(segment.op) ? 'var(--av-error)' : undefined }}
      title={title}>{segment.raw}</span>;
  })}</span>;
}

export function DictationComparison({ grade }: { grade: any }) {
  if (grade.grading_version === LEXICAL_DICTATION_POLICY) return <div>
    <p className="dict-next-reference"><span>Transcript</span><DictationRawText grade={grade} side="reference" /></p>
    <p className="dict-next-user-answer"><span>Bạn đã gõ</span><DictationRawText grade={grade} side="user" /></p>
    <small>Dấu và ký hiệu không tính điểm được hiển thị riêng; chỉ từ được đánh dấu thiếu, sai hoặc thừa. Từ ngập ngừng được miễn tính điểm khi bỏ sót hoặc thay bằng từ ngập ngừng khác. Từ thừa được ghi trong mẫu lỗi; điểm tính theo số từ đúng trên tổng từ được chấm của transcript.</small>
  </div>;
  return <span className="dict-next-diff">{grade.diff.map((operation: any, index: number) => {
    const word = operation.op === 'miss' ? operation.expected : (operation.actual || operation.expected || '');
    if (operation.filler) return <span className="is-filler" key={index} title="Từ ngập ngừng, không trừ điểm">{word} </span>;
    if (operation.op === 'wrong') return <span className="is-wrong" key={index} title="Sai từ"><s>{operation.actual}</s> {operation.expected} </span>;
    return <span className={`is-${operation.op}`} key={index}>{word} </span>;
  })}</span>;
}
