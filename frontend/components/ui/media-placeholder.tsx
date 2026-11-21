import type { ReactNode } from 'react';

import styles from './media-placeholder.module.css';
import { cx } from './cx';

export type MediaPlaceholderKind = 'illustration' | 'video' | 'chart';

export type MediaPlaceholderProps = {
  kind: MediaPlaceholderKind;
  /** `w:h`, e.g. "4:3" (default) or "16:9". */
  ratio?: `${number}:${number}`;
  /** What will go here, e.g. "nguồn · thời lượng" or "ảnh đề bài". */
  caption: string;
  /** Overrides the bracket tag, e.g. "BIỂU ĐỒ TASK 1". */
  tag?: string;
  /** An illustration drawn in code (sentence diagram) instead of the tag. */
  children?: ReactNode;
  className?: string;
};

const TAGS: Record<MediaPlaceholderKind, string> = { illustration: 'MINH HOẠ', video: 'VIDEO', chart: 'BIỂU ĐỒ' };

/**
 * Space kept for media that is not ready yet (UIBASE-0056 FR-005, ThanhPhan §5).
 * Keeps the final aspect ratio so the page does not jump when the media lands.
 */
export function MediaPlaceholder({ kind, ratio = '4:3', caption, tag, children, className }: MediaPlaceholderProps) {
  const [w, h] = ratio.split(':');
  const label = `[${tag ?? TAGS[kind]}] ${caption}`;
  return (
    <div
      role="img"
      aria-label={label}
      className={cx(styles.media, styles[kind], className)}
      style={{ aspectRatio: `${w} / ${h}` }}
    >
      {children ? (
        <>
          {children}
          <span className={styles.caption}>{caption}</span>
        </>
      ) : (
        label
      )}
    </div>
  );
}

/**
 * A number that is not decided yet (price, duration, AI credits): prints `XXX`
 * where the value will sit, never a made-up figure (plan 5.4 #14).
 */
export function PendingValue() {
  return <abbr title="Chưa chốt" className={styles.pending}>XXX</abbr>;
}
