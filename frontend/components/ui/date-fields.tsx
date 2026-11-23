'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import {
  WEEKDAYS, WEEKDAYS_SHORT, addDays, addMonths, daysBetweenInclusive, formatDate, formatLongDate, monthGrid,
  monthTitle, parseDate, parseTime, splitIso, timeSteps, todayIso, weekdayName,
} from '@/lib/av2-date.mjs';

import fieldStyles from './field.module.css';
import styles from './date-fields.module.css';
import { cx } from './cx';

type Mark = 'one' | 'start' | 'end' | 'mid' | null;

const PHONE_QUERY = '(max-width: 767px)';
const isPhone = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(PHONE_QUERY).matches;

function CalendarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <rect x="1.5" y="3" width="15" height="13.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M1.5 7h15M5.5 1v4M12.5 1v4" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <circle cx="9" cy="9" r="7.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M9 4.5V9l3 2" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** A popover under the field on wide screens, a bottom sheet with "Xong" on the phone. Esc and a click outside close it. */
function usePopover(onClose: (refocus: boolean) => void) {
  const wrap = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) closeRef.current(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (open && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeRef.current(true);
    }
  };
  return { wrap, open, setOpen, onKeyDown };
}

function Calendar({
  month, onMonthChange, today, isDisabled, mark, onPick, status, onDone,
}: {
  month: string;
  onMonthChange: (month: string) => void;
  today: string;
  isDisabled: (iso: string) => boolean;
  mark: (iso: string) => Mark;
  onPick: (iso: string) => void;
  status: ReactNode;
  onDone: () => void;
}) {
  const weeks = monthGrid(month);
  const days = weeks.flat().filter((d): d is string => d !== null);
  const initial = days.find((d) => mark(d) === 'one' || mark(d) === 'start') ?? (days.includes(today) ? today : days[0]);
  const [focus, setFocus] = useState(initial);
  const keyNav = useRef(false);
  const grid = useRef<HTMLTableElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!days.includes(focus)) setFocus(days.includes(today) ? today : days[0]);
  }, [month]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!keyNav.current) return;
    keyNav.current = false;
    grid.current?.querySelector<HTMLButtonElement>(`[data-day="${focus}"]`)?.focus();
  }, [focus, month]);

  const move = (event: KeyboardEvent<HTMLTableElement>) => {
    const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
    if (delta === undefined) return;
    event.preventDefault();
    const next = addDays(focus, delta);
    keyNav.current = true;
    if (next.slice(0, 7) !== month) onMonthChange(next.slice(0, 7));
    setFocus(next);
  };

  return (
    <div className={styles.calendar}>
      <div className={styles.calHead}>
        <button type="button" className={styles.navButton} aria-label="Tháng trước" onClick={() => onMonthChange(addMonths(month, -1))}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M9 2L4 7l5 5" fill="none" stroke="currentColor" strokeWidth="1.75" /></svg>
        </button>
        <h3 id={titleId} className={styles.calTitle} aria-live="polite">{monthTitle(month)}</h3>
        <button type="button" className={styles.navButton} aria-label="Tháng sau" onClick={() => onMonthChange(addMonths(month, 1))}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M5 2l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.75" /></svg>
        </button>
      </div>
      <table ref={grid} className={styles.grid} aria-labelledby={titleId} onKeyDown={move}>
        <thead>
          <tr>{WEEKDAYS_SHORT.map((d, i) => <th key={d} scope="col" abbr={WEEKDAYS[i]} className={styles.dow}>{d}</th>)}</tr>
        </thead>
        <tbody>
          {weeks.map((week, w) => (
            <tr key={w}>
              {week.map((iso, i) => {
                if (!iso) return <td key={i} className={styles.dayCell} />;
                const m = mark(iso);
                const disabled = isDisabled(iso);
                const isToday = iso === today;
                const words = [
                  formatLongDate(iso),
                  isToday ? 'hôm nay' : '',
                  disabled ? 'không chọn được' : '',
                  m === 'one' ? 'đang chọn' : m === 'start' ? 'ngày bắt đầu' : m === 'end' ? 'ngày kết thúc' : m === 'mid' ? 'trong khoảng đã chọn' : '',
                ].filter(Boolean).join(', ');
                return (
                  <td key={iso} className={styles.dayCell}>
                    <button
                      type="button"
                      data-day={iso}
                      tabIndex={iso === focus ? 0 : -1}
                      disabled={disabled}
                      aria-pressed={m === 'one' || m === 'start' || m === 'end'}
                      aria-label={words}
                      className={cx(
                        styles.day,
                        isToday && styles.today,
                        (m === 'one' || m === 'start' || m === 'end') && styles.picked,
                        m === 'mid' && styles.between,
                      )}
                      onClick={() => { setFocus(iso); onPick(iso); }}
                    >
                      {Number(iso.slice(8, 10))}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p role="status" className={styles.calStatus}>{status}</p>
      <button type="button" className={styles.done} onClick={onDone}>Xong</button>
    </div>
  );
}

export type DateFieldProps = {
  label: string;
  /** ISO date ("2026-11-17") or ''. */
  value: string;
  onChange: (value: string) => void;
  /** ISO bounds; days outside are locked in the calendar and refused when typed. */
  min?: string;
  max?: string;
  /** ISO "today" for the calendar's mark; defaults to the device's date. */
  today?: string;
  /** An outside error (e.g. from the server); a typing error wins over it. */
  error?: string;
  id?: string;
  className?: string;
};

/**
 * Date field of the "Bản in" UI (UIBASE-0056 FR-005, ThanhPhanDuLieu §9).
 * Typed by hand as dd/mm/yyyy (never `<input type="date">`, whose format
 * follows the device); the calendar only helps. Weeks start on Monday; an
 * impossible date says why. On the phone the calendar is a bottom sheet with
 * a "Xong" button.
 */
export function DateField({ label, value, onChange, min, max, today, error, id, className }: DateFieldProps) {
  const auto = useId();
  const inputId = id ?? `df-${auto}`;
  const noteId = `${inputId}-note`;
  const dialogId = `${inputId}-calendar`;
  const trigger = useRef<HTMLButtonElement>(null);
  const [text, setText] = useState(formatDate(value));
  const [typingError, setTypingError] = useState('');
  const [month, setMonth] = useState((value || today || todayIso()).slice(0, 7));
  const close = (refocus: boolean) => {
    pop.setOpen(false);
    if (refocus) trigger.current?.focus();
  };
  const pop = usePopover(close);

  useEffect(() => { setText(formatDate(value)); }, [value]);

  const commit = (raw: string) => {
    const parsed = parseDate(raw, { min, max });
    if (parsed.error !== undefined) { setTypingError(parsed.error); return; }
    setTypingError('');
    setText(formatDate(parsed.value));
    if (parsed.value !== value) onChange(parsed.value);
  };

  const shown = typingError || error;
  const note = shown ?? `dd/mm/yyyy${splitIso(value) ? ` · ${weekdayName(value)}` : ''}`;
  const now = today ?? todayIso();

  return (
    <div ref={pop.wrap} className={cx(fieldStyles.field, styles.wrap, className)} onKeyDown={pop.onKeyDown}>
      <label htmlFor={inputId} className={fieldStyles.label}>{label}</label>
      <div className={styles.joined}>
        <input
          id={inputId}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="dd/mm/yyyy"
          value={text}
          aria-invalid={shown ? true : undefined}
          aria-describedby={noteId}
          className={cx(fieldStyles.control, styles.input)}
          onChange={(event) => setText(event.target.value)}
          onBlur={(event) => commit(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commit(text); } }}
        />
        <button
          ref={trigger}
          type="button"
          className={styles.trigger}
          aria-label={`Mở lịch chọn ${label.toLowerCase()}`}
          aria-expanded={pop.open}
          aria-controls={pop.open ? dialogId : undefined}
          onClick={() => {
            if (pop.open) { close(false); return; }
            setMonth((value || now).slice(0, 7));
            pop.setOpen(true);
          }}
        >
          <CalendarIcon />
        </button>
      </div>
      <span id={noteId} className={shown ? fieldStyles.error : fieldStyles.hint}>{note}</span>
      {pop.open ? (
        <div id={dialogId} role="dialog" aria-label={`Chọn ${label.toLowerCase()}`} className={styles.popover}>
          <Calendar
            month={month}
            onMonthChange={setMonth}
            today={now}
            isDisabled={(iso) => Boolean((min && iso < min) || (max && iso > max))}
            mark={(iso) => (iso === value ? 'one' : null)}
            onPick={(iso) => {
              setTypingError('');
              onChange(iso);
              if (!isPhone()) close(true);
            }}
            status={splitIso(value) ? `Đã chọn: ${formatLongDate(value)}` : 'Chưa chọn ngày'}
            onDone={() => close(true)}
          />
        </div>
      ) : null}
    </div>
  );
}

export type TimeFieldProps = {
  label: string;
  /** "19:30" or ''. */
  value: string;
  onChange: (value: string) => void;
  /** Minutes between choices in the list (default 15). */
  step?: number;
  from?: string;
  to?: string;
  /** Times that cannot be picked, with the reason shown: { '20:00': 'lớp khác' }. */
  unavailable?: Readonly<Record<string, string>>;
  error?: string;
  id?: string;
  className?: string;
};

/** Time field (ThanhPhanDuLieu §9): typed as 24-hour hh:mm; the list (every `step` minutes) only helps. */
export function TimeField({ label, value, onChange, step = 15, from = '06:00', to = '22:00', unavailable = {}, error, id, className }: TimeFieldProps) {
  const auto = useId();
  const inputId = id ?? `tm-${auto}`;
  const noteId = `${inputId}-note`;
  const listId = `${inputId}-list`;
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [text, setText] = useState(value);
  const [typingError, setTypingError] = useState('');
  const close = (refocus: boolean) => {
    pop.setOpen(false);
    if (refocus) trigger.current?.focus();
  };
  const pop = usePopover(close);

  useEffect(() => { setText(value); }, [value]);
  useEffect(() => {
    if (!pop.open) return;
    const current = list.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]') ?? list.current?.querySelector<HTMLButtonElement>('button:not(:disabled)');
    current?.focus();
    if (typeof current?.scrollIntoView === 'function') current.scrollIntoView({ block: 'nearest' });
  }, [pop.open]);

  const commit = (raw: string) => {
    const parsed = parseTime(raw);
    if (parsed.error !== undefined) { setTypingError(parsed.error); return; }
    setTypingError('');
    setText(parsed.value);
    if (parsed.value !== value) onChange(parsed.value);
  };

  const shown = typingError || error;
  const times = timeSteps(from, to, step);

  return (
    <div ref={pop.wrap} className={cx(fieldStyles.field, styles.wrap, className)} onKeyDown={pop.onKeyDown}>
      <label htmlFor={inputId} className={fieldStyles.label}>{label}</label>
      <div className={styles.joined}>
        <input
          id={inputId}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="hh:mm"
          value={text}
          aria-invalid={shown ? true : undefined}
          aria-describedby={noteId}
          className={cx(fieldStyles.control, styles.input)}
          onChange={(event) => setText(event.target.value)}
          onBlur={(event) => commit(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commit(text); } }}
        />
        <button
          ref={trigger}
          type="button"
          className={styles.trigger}
          aria-label="Mở danh sách giờ"
          aria-expanded={pop.open}
          aria-controls={pop.open ? listId : undefined}
          onClick={() => (pop.open ? close(false) : pop.setOpen(true))}
        >
          <ClockIcon />
        </button>
      </div>
      <span id={noteId} className={shown ? fieldStyles.error : fieldStyles.hint}>{shown ?? '24 giờ, ví dụ 07:05 hoặc 19:30'}</span>
      {pop.open ? (
        <div className={cx(styles.popover, styles.timePopover)}>
          <ul ref={list} id={listId} className={styles.times} aria-label={`Chọn ${label.toLowerCase()}`}>
            {times.map((t) => {
              const reason = unavailable[t];
              const on = t === value;
              return (
                <li key={t}>
                  <button
                    type="button"
                    className={cx(styles.time, on && styles.timeOn)}
                    aria-pressed={on}
                    disabled={Boolean(reason)}
                    onClick={() => { setTypingError(''); onChange(t); close(true); }}
                  >
                    {t}
                    {on ? <span className={styles.timeNote}>đang chọn</span> : null}
                    {reason ? <span className={styles.timeNote}>· {reason}</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
          <button type="button" className={styles.done} onClick={() => close(true)}>Xong</button>
        </div>
      ) : null}
    </div>
  );
}

export type DateRange = { start: string; end: string };

export type DateRangeFieldProps = {
  legend: string;
  value: DateRange;
  onChange: (value: DateRange) => void;
  min?: string;
  max?: string;
  today?: string;
  startLabel?: string;
  endLabel?: string;
  error?: string;
  className?: string;
};

/**
 * Date range (ThanhPhanDuLieu §9): two typed dates and one calendar where the
 * first click is the start, the second the end; a third starts again. The
 * ends are dark, the days between light; the status line counts the days.
 */
export function DateRangeField({
  legend, value, onChange, min, max, today, startLabel = 'Từ ngày', endLabel = 'Đến ngày', error, className,
}: DateRangeFieldProps) {
  const auto = useId();
  const startId = `dr-${auto}-a`;
  const endId = `dr-${auto}-b`;
  const noteId = `dr-${auto}-note`;
  const dialogId = `dr-${auto}-calendar`;
  const trigger = useRef<HTMLButtonElement>(null);
  const [startText, setStartText] = useState(formatDate(value.start));
  const [endText, setEndText] = useState(formatDate(value.end));
  const [typingError, setTypingError] = useState('');
  const now = today ?? todayIso();
  const [month, setMonth] = useState((value.start || now).slice(0, 7));
  const close = (refocus: boolean) => {
    pop.setOpen(false);
    if (refocus) trigger.current?.focus();
  };
  const pop = usePopover(close);

  useEffect(() => { setStartText(formatDate(value.start)); }, [value.start]);
  useEffect(() => { setEndText(formatDate(value.end)); }, [value.end]);

  const commit = (which: 'start' | 'end', raw: string) => {
    const parsed = parseDate(raw, { min, max });
    if (parsed.error !== undefined) { setTypingError(parsed.error); return; }
    const next = { ...value, [which]: parsed.value };
    if (next.start && next.end && next.end < next.start) {
      setTypingError('Ngày kết thúc phải từ ngày bắt đầu trở đi.');
      return;
    }
    setTypingError('');
    if (next.start !== value.start || next.end !== value.end) onChange(next);
  };

  const pick = (iso: string) => {
    setTypingError('');
    if (!value.start || value.end || iso < value.start) {
      onChange({ start: iso, end: '' });
      return;
    }
    onChange({ start: value.start, end: iso });
    if (!isPhone()) close(true);
  };

  const mark = (iso: string): Mark => {
    if (iso === value.start) return 'start';
    if (iso === value.end) return 'end';
    if (value.start && value.end && iso > value.start && iso < value.end) return 'mid';
    return null;
  };

  const status = value.start && value.end
    ? `${formatDate(value.start).slice(0, 5)} – ${formatDate(value.end)} · ${daysBetweenInclusive(value.start, value.end)} ngày`
    : value.start ? `Từ ${formatDate(value.start)} · chọn ngày kết thúc` : 'Chọn ngày bắt đầu';
  const shown = typingError || error;

  const input = (which: 'start' | 'end', inputId: string, text: string, setText: (t: string) => void) => (
    <input
      id={inputId}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      placeholder="dd/mm/yyyy"
      value={text}
      aria-invalid={shown ? true : undefined}
      aria-describedby={noteId}
      className={cx(fieldStyles.control, styles.rangeInput)}
      onChange={(event) => setText(event.target.value)}
      onBlur={(event) => commit(which, event.target.value)}
      onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commit(which, text); } }}
    />
  );

  return (
    <div ref={pop.wrap} className={cx(styles.wrap, className)} onKeyDown={pop.onKeyDown}>
      <fieldset className={styles.fieldset}>
        <legend className={cx(fieldStyles.label, styles.legend)}>{legend}</legend>
        <div className={styles.rangeRow}>
          <span className={styles.rangePart}>
            <label htmlFor={startId} className={styles.rangeLabel}>{startLabel}</label>
            {input('start', startId, startText, setStartText)}
          </span>
          <span aria-hidden="true" className={styles.dash}>–</span>
          <span className={styles.rangePart}>
            <label htmlFor={endId} className={styles.rangeLabel}>{endLabel}</label>
            <span className={styles.joined}>
              {input('end', endId, endText, setEndText)}
              <button
                ref={trigger}
                type="button"
                className={styles.trigger}
                aria-label={`Mở lịch chọn ${legend.toLowerCase()}`}
                aria-expanded={pop.open}
                aria-controls={pop.open ? dialogId : undefined}
                onClick={() => {
                  if (pop.open) { close(false); return; }
                  setMonth((value.start || now).slice(0, 7));
                  pop.setOpen(true);
                }}
              >
                <CalendarIcon />
              </button>
            </span>
          </span>
        </div>
        <span id={noteId} className={shown ? fieldStyles.error : fieldStyles.hint}>{shown ?? `${startLabel} – ${endLabel.toLowerCase()}, dd/mm/yyyy`}</span>
      </fieldset>
      {pop.open ? (
        <div id={dialogId} role="dialog" aria-label="Chọn khoảng ngày" className={styles.popover}>
          <Calendar
            month={month}
            onMonthChange={setMonth}
            today={now}
            isDisabled={(iso) => Boolean((min && iso < min) || (max && iso > max))}
            mark={mark}
            onPick={pick}
            status={status}
            onDone={() => close(true)}
          />
        </div>
      ) : null}
    </div>
  );
}
