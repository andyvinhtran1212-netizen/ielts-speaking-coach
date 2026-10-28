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
    {error || (!ready ? 'Đang tải đánh dấu xem lại…' : failed ? `Chưa lưu được đánh dấu xem lại của ${failed} câu. Thay đổi của bạn vẫn đang hiển thị trong tab này.` : 'Đang lưu đánh dấu xem lại…')}
    {error || failed ? <button type="button" onClick={onRetry}>Retry review marks</button> : null}
  </p>;
}
