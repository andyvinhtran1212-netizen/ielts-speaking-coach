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
    {error || (!ready ? 'Loading review marks…' : failed ? `${failed} review marks could not be saved. Your changes are still shown in this tab.` : 'Saving review marks…')}
    {error || failed ? <button type="button" onClick={onRetry}>Retry review marks</button> : null}
  </p>;
}
