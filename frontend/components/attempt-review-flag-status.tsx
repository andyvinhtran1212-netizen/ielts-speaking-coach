'use client';

export function AttemptReviewFlagStatus({ ready, states, error, onRetry }: {
  ready: boolean;
  states: Map<number, string>;
  error: string;
  onRetry(): void;
}) {
  const failed = [...states.values()].filter((state) => state === 'failed').length;
  if (ready && !error && !states.size) return null;
  return <p role="status" className="exam-review-flag-status">
    {error || (!ready ? 'Đang tải cờ Review…' : failed ? `${failed} cờ Review chưa lưu được. Thay đổi của bạn vẫn đang hiển thị trong tab này.` : 'Đang lưu cờ Review…')}
    {error || failed ? <button type="button" onClick={onRetry}>Thử lại cờ Review</button> : null}
  </p>;
}
