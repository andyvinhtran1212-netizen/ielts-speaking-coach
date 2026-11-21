import styles from './status-badge.module.css';
import { cx } from './cx';

type Tone = 'muted' | 'ink' | 'accent' | 'ok' | 'okSolid' | 'mark' | 'danger' | 'off';
type Entry = { label: string; tone: Tone; joiner?: string };

/**
 * The one set of status words for the whole site (ThanhPhan §3). Always
 * Vietnamese text plus colour; never "draft", "published", "live", "graded".
 */
export const STATUS_BADGE_SETS = {
  work: {
    not_started: { label: 'Chưa làm', tone: 'muted' },
    in_progress: { label: 'Đang làm', tone: 'ink' },
    submitted: { label: 'Đã nộp · chờ chấm', tone: 'accent' },
    graded: { label: 'Đã chấm', tone: 'ok' },
    returned: { label: 'Đã trả bài', tone: 'okSolid' },
    overdue: { label: 'Quá hạn', tone: 'danger', joiner: ' ' },
  },
  content: {
    draft: { label: 'Bản nháp', tone: 'muted' },
    published: { label: 'Đã phát hành', tone: 'ok' },
    archived: { label: 'Lưu trữ', tone: 'off' },
  },
  access: {
    active: { label: 'Đang học', tone: 'ok' },
    expiring: { label: 'Sắp hết hạn', tone: 'mark' },
    expired: { label: 'Hết hạn', tone: 'danger' },
    locked: { label: 'Đã khoá', tone: 'off' },
  },
} as const satisfies Record<string, Record<string, Entry>>;

type Sets = typeof STATUS_BADGE_SETS;

export type StatusBadgeProps = {
  [S in keyof Sets]: {
    set: S;
    value: keyof Sets[S];
    /** Appended to the label: "Quá hạn 2 ngày", "Sắp hết hạn · còn 7 ngày". */
    detail?: string;
    className?: string;
  };
}[keyof Sets];

const TONE: Record<Tone, string> = {
  muted: styles.muted, ink: styles.ink, accent: styles.accent, ok: styles.ok, okSolid: styles.okSolid,
  mark: styles.mark, danger: styles.danger, off: styles.off,
};

/** Status label (UIBASE-0056 FR-005, ThanhPhan §3). Colour is never the only signal: the word is. */
export function StatusBadge({ set, value, detail, className }: StatusBadgeProps) {
  const entry = (STATUS_BADGE_SETS[set] as Record<string, Entry>)[value as string];
  const text = detail ? `${entry.label}${entry.joiner ?? ' · '}${detail}` : entry.label;
  return <span className={cx(styles.badge, TONE[entry.tone], className)}>{text}</span>;
}
