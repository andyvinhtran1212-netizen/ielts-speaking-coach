import { PendingValue } from '../media-placeholder';
import styles from './learner-shell.module.css';

export type AiCredits = { remaining: number | null; low: boolean };

export type AiCreditsIndicatorProps = {
  /**
   * One shared count. `remaining: null` → `PendingValue` (loading or not
   * decided). Not passed / null → hidden (e.g. the credits API failed): the
   * bar never shows a made-up 0.
   */
  credits?: AiCredits | null;
  /** Account without a course (FR-016): "Chấm thử hôm nay còn N bài". Wins over `credits`. */
  trialLeft?: number | null;
};

/**
 * AI credits on the learner bar (KhungTrang §1). Full text from 1024px, "Lượt AI N"
 * below. Low: the words "Sắp hết" are there, never colour alone.
 */
export function AiCreditsIndicator({ credits, trialLeft }: AiCreditsIndicatorProps) {
  if (typeof trialLeft === 'number') {
    return (
      <span className={styles.credits} data-credits="trial">
        Chấm thử hôm nay còn <strong>{trialLeft}</strong> bài
      </span>
    );
  }
  if (!credits) return null;
  const value = credits.remaining === null ? <PendingValue /> : credits.remaining;
  if (credits.low) {
    return (
      <a href="/account" className={styles.credits} data-credits="low">
        Sắp hết · còn {value} lượt
      </a>
    );
  }
  return (
    <a href="/account" className={styles.credits} data-credits="normal">
      <span className={styles.wideText}>Lượt chấm AI còn </span>
      <span className={styles.narrowText}>Lượt AI </span>
      <strong>{value}</strong>
    </a>
  );
}
