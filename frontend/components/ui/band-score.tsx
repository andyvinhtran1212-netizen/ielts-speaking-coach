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

/** A real IELTS band: finite, 0–9, in half-band steps. Anything else is never drawn. */
export function isValidBand(band: unknown): band is number {
  return typeof band === 'number' && Number.isFinite(band) && band >= 0 && band <= 9 && Number.isInteger(band * 2);
}

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
  const hasBand = state === 'ready' && isValidBand(band);
  // A band that is present but not a real half band 0–9 is a data error, not
  // "not enough work yet": say so, with no number and no next-step action.
  const invalid = state === 'ready' && band != null && !hasBand;
  const label = LABEL[size](skill);
  const compare = hasBand && previous && isValidBand(previous.band) ? compareSentence(band, previous) : null;
  const disclaimer = size === 'md' || size === 'row'
    ? `Không phải điểm thi${basis ? ` · ${basis}` : ''}`
    : `${BAND_DISCLAIMER}.${basis ? ` ${basis}.` : ''}`;

  return (
    <div className={cx(styles.band, styles[size], className)} data-state={hasBand ? 'ready' : invalid ? 'invalid' : state === 'grading' ? 'grading' : 'insufficient'}>
      <p className={styles.label}>{size === 'row' ? skill : label}</p>
      {hasBand ? (
        <>
          <p className={styles.value}><span className={styles.hidden}>{label}: </span>{formatBand(band)}</p>
          {compare ? <p className={styles.compare}>{compare}.</p> : null}
          <p className={styles.disclaimer}>{disclaimer}</p>
        </>
      ) : invalid ? (
        <p className={styles.waiting}>Chưa có band · dữ liệu điểm chưa hợp lệ</p>
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
          <dd className={styles.criterionBand}>{isValidBand(c.band) ? formatBand(c.band) : 'Chưa có'}</dd>
          {c.note ? <dd className={styles.criterionNote}>{c.note}</dd> : null}
        </div>
      ))}
    </dl>
  );
}

/** Fixed skill codes; the label is derived from the code, never passed in. */
export type IeltsSkill = 'listening' | 'reading' | 'writing' | 'speaking';
export const IELTS_SKILLS: readonly IeltsSkill[] = ['listening', 'reading', 'writing', 'speaking'];
const SKILL_LABEL: Record<IeltsSkill, string> = {
  listening: 'Listening', reading: 'Reading', writing: 'Writing', speaking: 'Speaking',
};

/** One skill of a mock test. `band: null` means still being marked. */
export type OverallSkill = { skill: IeltsSkill; band: number | null; pendingLabel?: string };

export type OverallBlockProps = {
  /** One row per skill code. Missing, duplicated or unknown codes, or an invalid band, give no Overall. */
  skills: OverallSkill[];
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

export type OverallStatus =
  | { kind: 'ready'; overall: number }
  | { kind: 'pending'; grading: IeltsSkill[]; absent: IeltsSkill[] }
  | { kind: 'invalid' };

/**
 * Whether an Overall can be drawn: exactly one row for each of Listening,
 * Reading, Writing and Speaking, every band a valid half-band 0–9. Duplicate
 * or unknown codes and invalid bands are `invalid`; missing rows or null bands
 * are `pending`.
 */
export function overallStatus(skills: readonly OverallSkill[]): OverallStatus {
  const seen = new Map<IeltsSkill, OverallSkill>();
  for (const row of skills) {
    if (!IELTS_SKILLS.includes(row?.skill) || seen.has(row.skill)) return { kind: 'invalid' };
    if (row.band != null && !isValidBand(row.band)) return { kind: 'invalid' };
    seen.set(row.skill, row);
  }
  const absent = IELTS_SKILLS.filter((code) => !seen.has(code));
  const grading = IELTS_SKILLS.filter((code) => seen.get(code)?.band == null && seen.has(code));
  if (absent.length || grading.length) return { kind: 'pending', grading, absent };
  return { kind: 'ready', overall: ieltsOverall(IELTS_SKILLS.map((code) => seen.get(code)!.band as number)) };
}

function waitingLine(status: Exclude<OverallStatus, { kind: 'ready' }>): string {
  if (status.kind === 'invalid') return 'Chưa có Overall · dữ liệu điểm chưa hợp lệ';
  const parts = [
    status.grading.length ? `${status.grading.map((c) => SKILL_LABEL[c]).join(', ')} đang chấm` : '',
    status.absent.length ? `chưa có ${status.absent.map((c) => SKILL_LABEL[c]).join(', ')}` : '',
  ].filter(Boolean);
  return `Chưa có Overall · ${parts.join(' · ')}`;
}

/**
 * Overall of an assigned mock test. The number appears only when all four
 * skills are present once each with a valid band; otherwise it says why. The
 * table always lists the four skills in the fixed order.
 */
export function OverallBlock({ skills, note, className }: OverallBlockProps) {
  const status = overallStatus(skills);
  const invalid = status.kind === 'invalid';
  const byCode = new Map(skills.filter((s) => IELTS_SKILLS.includes(s?.skill)).map((s) => [s.skill, s]));
  return (
    <div className={cx(styles.overall, className)}>
      <div className={styles.overallHead}>
        <p className={styles.label}>Overall ước lượng</p>
        {status.kind === 'ready' ? (
          <p className={styles.overallValue}><span className={styles.hidden}>Overall ước lượng: </span>{formatBand(status.overall)}</p>
        ) : (
          <p className={styles.waiting}>{waitingLine(status)}</p>
        )}
      </div>
      <dl className={styles.skills}>
        {IELTS_SKILLS.map((code) => {
          const row = byCode.get(code);
          const shown = !invalid && row && isValidBand(row.band);
          const text = invalid ? '—' : !row ? 'Chưa có' : shown ? formatBand(row.band as number) : (row.pendingLabel ?? 'Đang chấm');
          return (
            <div key={code} className={styles.skill}>
              <dt lang="en">{SKILL_LABEL[code]}</dt>
              <dd className={shown ? styles.skillBand : styles.skillPending}>{text}</dd>
            </div>
          );
        })}
      </dl>
      <p className={styles.disclaimer}>{BAND_DISCLAIMER}.{note ? <> {note}</> : null}</p>
    </div>
  );
}
