import type { ReactNode } from 'react';

import styles from './band-score.module.css';
import { cx } from './cx';

export type BandScoreSize = 'lg' | 'md' | 'row' | 'phone';
export type BandScoreState = 'ready' | 'insufficient' | 'grading';
export type BandCriterion = { name: string; band: number | null; note?: string };
export type PreviousBand = { band: number; date?: string };

export type BandScoreProps = {
  size?: BandScoreSize;
  state?: BandScoreState;
  /** Skill or task: "Writing Task 2", "Listening". */
  skill: string;
  /** Shown only when `state` is `ready`; never drawn for the other states. */
  band?: number | null;
  /** How much the estimate rests on: "Dựa trên 1 bài, 268 từ". */
  basis?: string;
  /** Only pass a previous band of the same kind of work (Task 2 with Task 2). */
  previous?: PreviousBand;
  /** Lg / phone only: the four criteria under the band. */
  criteria?: BandCriterion[];
  /** Line under "Chưa đủ bài…" or "Đang chấm…" (what is missing, how long). */
  note?: ReactNode;
  /** Next step for `insufficient` ("Làm một đề đủ"), rendered after the note. */
  action?: ReactNode;
  className?: string;
};

export const BAND_DISCLAIMER = 'Điểm ước lượng, không phải điểm thi';

/** "6.0", "6.5": bands always carry one decimal. */
export function formatBand(band: number): string {
  return band.toFixed(1);
}

/**
 * The comparison said in words (ThanhPhanHocTap §1 "Cách nói so với lần
 * trước"): never an arrow, a percent or a colour alone, and always the earlier
 * band (and its date when known).
 */
export function compareSentence(band: number, previous: PreviousBand): string {
  const diff = Math.round((band - previous.band) * 10) / 10;
  const when = previous.date ? `${formatBand(previous.band)}, bài ngày ${previous.date}` : formatBand(previous.band);
  if (diff === 0) return `Giữ nguyên so với lần trước (${when})`;
  const dir = diff > 0 ? 'Cao hơn' : 'Thấp hơn';
  return `${dir} lần trước ${formatBand(Math.abs(diff))} band (${when})`;
}

const LABEL: Record<BandScoreSize, (skill: string) => string> = {
  lg: (skill) => `Band ước lượng · ${skill}`,
  phone: () => 'Band ước lượng',
  md: (skill) => `${skill} · band ước lượng`,
  row: () => 'Band',
};

/**
 * Band block of the "Bản in" UI (UIBASE-0056 FR-005, ThanhPhanHocTap §1).
 * `insufficient` and `grading` never draw a number; a drawn band always comes
 * with "Điểm ước lượng, không phải điểm thi" and what it is based on.
 */
export function BandScore({
  size = 'lg', state = 'ready', skill, band, basis, previous, criteria, note, action, className,
}: BandScoreProps) {
  const hasBand = state === 'ready' && typeof band === 'number' && Number.isFinite(band);
  const label = LABEL[size](skill);
  const compare = hasBand && previous ? compareSentence(band, previous) : null;
  const disclaimer = size === 'md' || size === 'row'
    ? `Không phải điểm thi${basis ? ` · ${basis}` : ''}`
    : `${BAND_DISCLAIMER}.${basis ? ` ${basis}.` : ''}`;

  return (
    <div className={cx(styles.band, styles[size], className)} data-state={hasBand ? 'ready' : state}>
      <p className={styles.label}>{size === 'row' ? skill : label}</p>
      {hasBand ? (
        <>
          <p className={styles.value} aria-label={`${label}: ${formatBand(band)}`}>{formatBand(band)}</p>
          {compare ? <p className={styles.compare}>{compare}.</p> : null}
          <p className={styles.disclaimer}>{disclaimer}</p>
        </>
      ) : state === 'grading' ? (
        <>
          <p className={styles.waiting} role="status">Đang chấm…</p>
          {note ? <p className={styles.note}>{note}</p> : null}
        </>
      ) : (
        <>
          <p className={styles.waiting}>{size === 'md' ? 'Chưa đủ bài' : 'Chưa đủ bài để ước lượng'}</p>
          {note ? <p className={styles.note}>{note}</p> : null}
          {action ? <div className={styles.action}>{action}</div> : null}
        </>
      )}
      {hasBand && criteria?.length && (size === 'lg' || size === 'phone') ? <CriteriaList criteria={criteria} /> : null}
    </div>
  );
}

/** The four IELTS criteria; names stay in English as IELTS prints them. */
export function CriteriaList({ criteria, className }: { criteria: BandCriterion[]; className?: string }) {
  return (
    <dl className={cx(styles.criteria, className)}>
      {criteria.map((c) => (
        <div key={c.name} className={styles.criterion}>
          <dt lang="en" className={styles.criterionName}>{c.name}</dt>
          <dd className={styles.criterionBand}>{c.band == null ? 'Chưa có' : formatBand(c.band)}</dd>
          {c.note ? <dd className={styles.criterionNote}>{c.note}</dd> : null}
        </div>
      ))}
    </dl>
  );
}

export type OverallSkill = { name: string; band: number | null; pendingLabel?: string };

export type OverallBlockProps = {
  skills: OverallSkill[];
  /** Skills still being marked or not returned ("Speaking"). Any → no Overall. */
  missing?: string[];
  /** Line under the table (which mock test, which day). */
  note?: ReactNode;
  className?: string;
};

/**
 * IELTS Overall: mean of the four skill bands rounded to the nearest half
 * band, a quarter rounding up (6.25 → 6.5, 6.75 → 7.0).
 */
export function ieltsOverall(bands: number[]): number {
  const mean = bands.reduce((a, b) => a + b, 0) / bands.length;
  return Math.floor(mean * 2 + 0.5 + 1e-9) / 2;
}

/**
 * Overall of an assigned mock test. The number appears only when all four
 * skills have a band and nothing is missing; otherwise it says why.
 */
export function OverallBlock({ skills, missing = [], note, className }: OverallBlockProps) {
  const bands = skills.map((s) => s.band);
  const complete = skills.length === 4 && missing.length === 0 && bands.every((b) => typeof b === 'number');
  const overall = complete ? ieltsOverall(bands as number[]) : null;
  return (
    <div className={cx(styles.overall, className)}>
      <div className={styles.overallHead}>
        <p className={styles.label}>Overall ước lượng</p>
        {overall != null ? (
          <p className={styles.overallValue} aria-label={`Overall ước lượng: ${formatBand(overall)}`}>{formatBand(overall)}</p>
        ) : (
          <p className={styles.waiting}>Chưa có Overall{missing.length ? ` · ${missing.join(', ')} đang chấm` : ''}</p>
        )}
      </div>
      <dl className={styles.skills}>
        {skills.map((s) => (
          <div key={s.name} className={styles.skill}>
            <dt lang="en">{s.name}</dt>
            <dd className={s.band == null ? styles.skillPending : styles.skillBand}>
              {s.band == null ? (s.pendingLabel ?? 'Đang chấm') : formatBand(s.band)}
            </dd>
          </div>
        ))}
      </dl>
      <p className={styles.disclaimer}>{BAND_DISCLAIMER}.{note ? <> {note}</> : null}</p>
    </div>
  );
}
