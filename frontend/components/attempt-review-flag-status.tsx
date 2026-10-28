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
    {error || (!ready ? 'Đang tải các câu đã đánh dấu xem lại…' : failed ? `Chưa lưu được đánh dấu xem lại ở ${failed} câu. Thay đổi của bạn vẫn hiển thị trong tab này.` : 'Đang lưu đánh dấu xem lại…')}
    {error || failed ? <button type="button" onClick={onRetry}>Thử lưu lại</button> : null}
  </p>;
}
