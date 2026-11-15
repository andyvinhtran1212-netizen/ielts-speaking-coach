'use client';

import { useEffect, useState } from 'react';

import { useAuth } from '@/lib/auth/auth-provider';
import { useExerciseBookApi } from '@/lib/exercise-book/api-context';
import type { ActivityReview, PublicItem, ReviewItem } from '@/lib/exercise-book/contract';
import {
  PROVENANCE_LABEL,
  SOURCE_STATUS_LABEL,
  VERDICT_LABEL,
  displayValue,
  errorText,
  formatVnTime,
  itemLabel,
} from '@/lib/exercise-book/model';

import { LEARNER_LIST_HREF } from './exercise-book-runner';

type ItemLabels = Map<number, string>;

/**
 * Per-item renderer keyed by scoring mode. SELF-CHECK shows the saved answer
 * next to the reference and explanation and never a right/wrong verdict or a
 * score (Q-1). Any other mode (AUTO is reserved for later books, contract §5)
 * has no verdict field in v1, so it fails closed: nothing is inferred locally.
 */
function ReviewItemCard({ item, label }: { item: ReviewItem; label: string }) {
  const mode: string = item.scoring_mode;
  if (mode !== 'SELF-CHECK') {
    return (
      <article className="programme-review-item">
        <h2>{label}</h2>
        <p>Câu trả lời của bạn: {displayValue(item.saved_response)}</p>
        <p role="status">Chế độ chấm của câu này chưa được hỗ trợ trên trang này; không có kết quả chấm.</p>
      </article>
    );
  }
  return (
    <article className="programme-review-item">
      <h2>{label} · Tự đối chiếu</h2>
      <p>Câu trả lời của bạn: {item.blank ? 'để trống' : displayValue(item.saved_response)}</p>
      <p>Đáp án tham chiếu: {displayValue(item.reference)}</p>
      <p>Nguồn đáp án: {PROVENANCE_LABEL[item.reference_provenance] || 'chưa có'}</p>
      <p>Tình trạng nguồn: {SOURCE_STATUS_LABEL[item.source_status] || 'chưa có'}</p>
      <p>Kiểm tra học thuật: {VERDICT_LABEL[item.academic_verdict] || 'chưa có'}</p>
      <p>Giải thích: {item.explanation_vi || 'chưa có'}</p>
      {item.limitation_vi && <p>Lưu ý: {item.limitation_vi}</p>}
    </article>
  );
}

export function ExerciseBookReview({ review, labels, heading = 'Tự đối chiếu' }: { review: ActivityReview; labels?: ItemLabels; heading?: string }) {
  const summary = review.attempt.result_summary;
  return (
    <section className="programme-result" aria-label="Tự đối chiếu sau khi nộp">
      <h1>{heading} · {review.attempt.binding.activity_id}</h1>
      <p>Không chấm điểm tự động. Hãy so câu trả lời của bạn với đáp án tham chiếu và lời giải thích.</p>
      <p>Nộp lúc: {formatVnTime(review.attempt.submitted_at)}</p>
      {summary && <p>{summary.item_count} câu · {summary.blank_count} ô để trống</p>}
      {review.audio.url && <audio controls preload="none" src={review.audio.url} aria-label="Audio của activity đã nộp" />}
      {review.items.map((item) => (
        <ReviewItemCard key={item.source_item_id} item={item} label={labels?.get(item.q_num) || `Câu ${item.q_num}`} />
      ))}
      <details>
        <summary>Transcript của activity đã nộp</summary>
        {review.transcript.length ? review.transcript.map((line, index) => <p key={index}>{line.text}</p>) : <p>chưa có</p>}
      </details>
    </section>
  );
}

export function labelsFor(items: PublicItem[]): ItemLabels {
  return new Map(items.map((item) => [item.q_num, itemLabel(item)]));
}

export function LearnerReview({ attemptId }: { attemptId: string }) {
  const { status, user } = useAuth();
  if (status === 'signed-out') return <main className="programme-runner"><a href="/login">Đăng nhập để xem bài</a></main>;
  if (status !== 'signed-in') return <main className="programme-runner"><p role="status">Đang kiểm tra đăng nhập…</p></main>;
  return <LearnerReviewSession key={`${user?.id || ''}:${attemptId}`} attemptId={attemptId} />;
}

function LearnerReviewSession({ attemptId }: { attemptId: string }) {
  const api = useExerciseBookApi();
  const [review, setReview] = useState<ActivityReview | null>(null);
  const [labels, setLabels] = useState<ItemLabels | undefined>();
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    setError('');
    setReview(null);
    void (async () => {
      const value = await api.getReview(attemptId);
      if (!active) return;
      setReview(value);
      // QA G13: reuse the runner's labels. Missing labels fall back to "Câu n".
      const classItem = value.attempt.context.class_assignment_item_id;
      if (!classItem) return;
      const player = await api.getPlayer(value.attempt.test_id, classItem).catch(() => null);
      if (active && player) setLabels(labelsFor(player.activity.items));
    })().catch((caught) => { if (active) setError(errorText(caught)); });
    return () => { active = false; };
  }, [api, attemptId, reload]);

  return (
    <main className="programme-runner">
      {error && (
        <>
          <p role="alert">{error}</p>
          <button type="button" onClick={() => setReload((value) => value + 1)}>Thử lại</button>
        </>
      )}
      {!error && !review && <p role="status">Đang tải phần tự đối chiếu…</p>}
      {review && <ExerciseBookReview review={review} labels={labels} />}
      <p><a href={LEARNER_LIST_HREF}>Về danh sách bài</a></p>
    </main>
  );
}
