import type { ReactNode } from 'react';

import styles from './chart.module.css';
import { cx } from './cx';

export type ChartPoint = { label: string; value: number };

export type ChartProps = {
  type: 'bar' | 'line';
  /** The conclusion, not the topic: "Bài nộp tăng đều 3 tuần gần đây". */
  title: string;
  /** What is measured and for whom: "Số bài nộp mỗi tuần · lớp Tue–Thu 19:30". */
  subtitle?: string;
  /** Legend and data-table row name of the series: "Bài đã nộp". */
  seriesLabel: string;
  /** Data-table row name of the categories: "Tuần", "Bài". */
  categoryLabel: string;
  data: readonly ChartPoint[];
  /** Axis words: "Trục ngang: tuần bắt đầu từ thứ Hai · trục dọc: số bài". */
  unit: string;
  /** "Nguồn: bài nộp trên Aver Learning, cập nhật 16/11/2026 08:00". */
  source: string;
  /** Line charts: a dashed reference line, e.g. the class target. */
  target?: { value: number; label: string };
  /** Value axis bounds; bars always start at 0. */
  domain?: { min: number; max: number; step: number };
  /** Digits after the decimal point for values and ticks; defaults to 1 when any value has a fraction. */
  decimals?: number;
  /** Fewer points than this shows the empty state (default 1 for bars, 2 for lines). */
  minPoints?: number;
  emptyTitle?: string;
  emptyBody?: ReactNode;
  className?: string;
};

const VIEW_W = 440;
const VIEW_H = 240;
const LEFT = 36;
const RIGHT = 436;
const TOP = 12;
const BASE = 208;

function niceStep(raw: number) {
  const power = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / power;
  return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 2.5 ? 2.5 : unit <= 5 ? 5 : 10) * power;
}

/** Value axis for the chart: bars from 0 with about four steps; lines hug the data with one step of air. */
export function chartDomain(type: ChartProps['type'], values: readonly number[], target?: number) {
  const all = target === undefined ? [...values] : [...values, target];
  const hi = Math.max(...all, 0);
  if (type === 'bar') {
    const step = niceStep(Math.max(hi, 1) / 4);
    return { min: 0, max: Math.ceil(hi / step) * step || step * 4, step };
  }
  const lo = Math.min(...all);
  const step = niceStep(Math.max(hi - lo, 3) / 3);
  const min = Math.max(0, Math.floor(lo / step) * step - (lo % step === 0 ? step : 0));
  const max = Math.ceil(hi / step) * step + (hi % step === 0 ? step : 0);
  return { min, max, step };
}

/**
 * Chart of the "Bản in" UI (UIBASE-0056 FR-005, ThanhPhanDuLieu §4): bars to
 * compare counts between periods, a line for one score over time. Hand-drawn
 * SVG (no chart.js, so it renders on the server and screenshots stay stable):
 * one accent colour for the data, everything else ink. Always a conclusion
 * title, axis words, the source, a text summary for screen readers and the
 * numbers in a table right below. Too little data shows words, never an
 * empty axis that reads as "zero".
 */
export function Chart({
  type, title, subtitle, seriesLabel, categoryLabel, data, unit, source, target, domain, decimals, minPoints,
  emptyTitle = 'Chưa đủ dữ liệu để vẽ biểu đồ', emptyBody, className,
}: ChartProps) {
  const enough = data.length >= (minPoints ?? (type === 'line' ? 2 : 1));
  const digits = decimals ?? (data.some((d) => !Number.isInteger(d.value)) || (target && !Number.isInteger(target.value)) ? 1 : 0);
  const fmt = (v: number) => v.toFixed(digits);

  if (!enough) {
    return (
      <figure className={cx(styles.chart, className)}>
        <h3 className={styles.title}>{title}</h3>
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>{emptyTitle}</p>
          {emptyBody ? <p className={styles.emptyBody}>{emptyBody}</p> : null}
        </div>
      </figure>
    );
  }

  const values = data.map((d) => d.value);
  const axis = domain ?? chartDomain(type, values, target?.value);
  const y = (v: number) => BASE - ((v - axis.min) / (axis.max - axis.min)) * (BASE - TOP);
  const band = (RIGHT - LEFT) / data.length;
  const cx_ = (i: number) => LEFT + band * (i + 0.5);
  const ticks: number[] = [];
  for (let v = axis.max; v >= axis.min - 1e-9; v -= axis.step) ticks.push(Math.round(v * 1e6) / 1e6);
  const last = data.length - 1;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const summary = `Biểu đồ ${type === 'bar' ? 'cột' : 'đường'}: ${subtitle ?? seriesLabel}, ${data.length} ${categoryLabel.toLowerCase()} từ ${data[0].label} đến ${data[last].label}: ${values.map(fmt).join(', ')}. Thấp nhất ${fmt(lo)}, cao nhất ${fmt(hi)}.${target ? ` ${target.label}.` : ''}`;
  const barWidth = Math.min(32, band * 0.6);

  return (
    <figure className={cx(styles.chart, className)}>
      <h3 className={styles.title}>{title}</h3>
      {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
      <p className={styles.legend}>
        <span className={styles.legendItem}>
          {type === 'bar' ? <span aria-hidden="true" className={styles.swatch} /> : (
            <svg width="24" height="10" viewBox="0 0 24 10" aria-hidden="true">
              <line x1="0" y1="5" x2="24" y2="5" className={styles.seriesLine} strokeWidth="2.5" />
              <circle cx="12" cy="5" r="3.5" className={styles.point} strokeWidth="2" />
            </svg>
          )}
          {seriesLabel}
        </span>
        {target ? (
          <span className={styles.legendItem}>
            <svg width="24" height="10" viewBox="0 0 24 10" aria-hidden="true">
              <line x1="0" y1="5" x2="24" y2="5" className={styles.targetLine} strokeWidth="1.5" strokeDasharray="4 3" />
            </svg>
            {target.label}
          </span>
        ) : null}
      </p>
      <svg role="img" aria-label={summary} viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} width="100%" className={styles.svg}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={LEFT} y1={y(t)} x2={RIGHT} y2={y(t)} className={t === axis.min ? styles.baseLine : styles.grid} strokeWidth="1" />
            <text x={LEFT - 8} y={y(t) + 4} textAnchor="end" className={styles.tick}>{fmt(t)}</text>
          </g>
        ))}
        {target ? (
          <>
            <line x1={LEFT} y1={y(target.value)} x2={RIGHT} y2={y(target.value)} className={styles.targetLine} strokeWidth="1.5" strokeDasharray="4 3" />
            <text x={RIGHT} y={y(target.value) - 6} textAnchor="end" className={styles.valueText}>{target.label.toLowerCase()}</text>
          </>
        ) : null}
        {type === 'bar' ? data.map((d, i) => (
          <g key={d.label}>
            <rect x={cx_(i) - barWidth / 2} y={y(d.value)} width={barWidth} height={BASE - y(d.value)} className={styles.bar} />
            <text x={cx_(i)} y={y(d.value) - 6} textAnchor="middle" className={cx(styles.valueText, i === last && styles.strong)}>{fmt(d.value)}</text>
          </g>
        )) : (
          <>
            <polyline points={data.map((d, i) => `${cx_(i)},${y(d.value)}`).join(' ')} fill="none" className={styles.seriesLine} strokeWidth="2.5" />
            {data.map((d, i) => <circle key={d.label} cx={cx_(i)} cy={y(d.value)} r="4" className={styles.point} strokeWidth="2" />)}
            <text x={cx_(last)} y={y(data[last].value) + 21} textAnchor="middle" className={cx(styles.valueText, styles.strong)}>{fmt(data[last].value)}</text>
          </>
        )}
        {data.map((d, i) => (
          <text key={d.label} x={cx_(i)} y={BASE + 18} textAnchor="middle" className={styles.tick}>{d.label}</text>
        ))}
      </svg>
      <p className={styles.axisNote}>{unit}</p>
      <figcaption className={styles.source}>{source}</figcaption>
      <div className={styles.tableFrame}>
        <table className={styles.table}>
          <caption className={styles.tableCaption}>Số liệu của biểu đồ</caption>
          <tbody>
            <tr>
              <th scope="row">{categoryLabel}</th>
              {data.map((d) => <td key={d.label}>{d.label}</td>)}
            </tr>
            <tr>
              <th scope="row">{seriesLabel}</th>
              {data.map((d) => <td key={d.label}>{fmt(d.value)}</td>)}
            </tr>
          </tbody>
        </table>
      </div>
    </figure>
  );
}
