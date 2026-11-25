// Date and time helpers of the "Bản in" date fields (UIBASE-0056 FR-005,
// ThanhPhanDuLieu §9, GOI-03 G03-T08): dates typed as dd/mm/yyyy, times as
// 24-hour hh:mm, weeks from Monday. Values travel as ISO strings
// ("2026-11-17", "19:30") so no time zone ever shifts a day. Plain functions,
// tested with `node --test` (tests/av2-date.test.mjs).

export const WEEKDAYS = Object.freeze(['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ Nhật']);
export const WEEKDAYS_SHORT = Object.freeze(['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']);

export const DATE_FORMAT_ERROR = 'Ngày viết theo dd/mm/yyyy, ví dụ 05/12/2026.';
export const TIME_FORMAT_ERROR = 'Giờ viết theo 24 giờ, ví dụ 07:05 hoặc 19:30.';

const pad = (n) => String(n).padStart(2, '0');

export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isoDate(year, month, day) {
  return `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`;
}

/** "2026-11-17" → { year, month, day }, or null when it is not a real date. */
export function splitIso(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

/** "2026-11-17" → "17/11/2026"; '' for anything else. */
export function formatDate(iso) {
  const d = splitIso(iso);
  return d ? `${pad(d.day)}/${pad(d.month)}/${d.year}` : '';
}

/** Monday = 0 … Sunday = 6. */
export function weekdayIndex(iso) {
  const d = splitIso(iso);
  if (!d) return -1;
  return (new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay() + 6) % 7;
}

export function weekdayName(iso) {
  const i = weekdayIndex(iso);
  return i < 0 ? '' : WEEKDAYS[i];
}

/** "Thứ Ba, 17/11/2026". */
export function formatLongDate(iso) {
  return splitIso(iso) ? `${weekdayName(iso)}, ${formatDate(iso)}` : '';
}

/**
 * Typed text → `{ value: iso }` or `{ error }`. Takes "17/11/2026",
 * "17-11-2026", "17.11.2026", "5/1/2027" and two-digit years ("17/11/26" →
 * 2026). An impossible day says why ("Tháng 11 chỉ có 30 ngày…"). Empty text
 * is `{ value: '' }`. `min` / `max` are ISO bounds.
 */
export function parseDate(text, { min, max } = {}) {
  const raw = String(text ?? '').trim();
  if (!raw) return { value: '' };
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(raw);
  if (!m) return { error: DATE_FORMAT_ERROR };
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  if (month < 1 || month > 12) return { error: 'Tháng chỉ từ 01 đến 12. Bạn kiểm tra lại ngày.' };
  if (day < 1) return { error: DATE_FORMAT_ERROR };
  const last = daysInMonth(year, month);
  if (day > last) {
    if (month === 2 && day === 29) return { error: `Năm ${year} không có ngày 29/02. Bạn kiểm tra lại ngày.` };
    return { error: `Tháng ${month} chỉ có ${last} ngày. Bạn kiểm tra lại ngày.` };
  }
  const value = isoDate(year, month, day);
  if (min && value < min) return { error: `Chọn từ ngày ${formatDate(min)} trở đi.` };
  if (max && value > max) return { error: `Chọn đến ngày ${formatDate(max)} là muộn nhất.` };
  return { value };
}

/** "19:30", "7:05", "1930", "19h30" → `{ value: "19:30" }`, or `{ error }`. */
export function parseTime(text) {
  const raw = String(text ?? '').trim().toLowerCase();
  if (!raw) return { value: '' };
  const m = /^(\d{1,2})(?:[:.h]?(\d{2}))?$/.exec(raw);
  if (!m) return { error: TIME_FORMAT_ERROR };
  const hour = Number(m[1]);
  const minute = m[2] === undefined ? 0 : Number(m[2]);
  if (m[2] === undefined && raw.length > 2) return { error: TIME_FORMAT_ERROR };
  if (hour > 23 || minute > 59) return { error: TIME_FORMAT_ERROR };
  return { value: `${pad(hour)}:${pad(minute)}` };
}

/** Times from `from` to `to` (inclusive), every `step` minutes: ["19:30", "19:45", …]. */
export function timeSteps(from = '06:00', to = '22:00', step = 15) {
  const toMinutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const out = [];
  for (let t = toMinutes(from); t <= toMinutes(to); t += step) out.push(`${pad(Math.floor(t / 60))}:${pad(t % 60)}`);
  return out;
}

/** "2026-11" → the month's weeks, Monday first; days outside the month are null. */
export function monthGrid(month) {
  const [year, mon] = month.split('-').map(Number);
  const first = weekdayIndex(isoDate(year, mon, 1));
  const total = daysInMonth(year, mon);
  const cells = [...Array(first).fill(null), ...Array.from({ length: total }, (_, i) => isoDate(year, mon, i + 1))];
  while (cells.length % 7) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** "2026-11" + 1 → "2026-12". */
export function addMonths(month, delta) {
  const [year, mon] = month.split('-').map(Number);
  const index = year * 12 + (mon - 1) + delta;
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`;
}

/** "2026-11" → "Tháng 11, 2026". */
export function monthTitle(month) {
  const [year, mon] = month.split('-').map(Number);
  return `Tháng ${mon}, ${year}`;
}

/** ISO date `days` later (negative for earlier). */
export function addDays(iso, days) {
  const d = splitIso(iso);
  if (!d) return '';
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + days));
  return isoDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Days from `start` to `end`, both counted: 17/11 – 20/11 is 4 days. */
export function daysBetweenInclusive(start, end) {
  const a = splitIso(start);
  const b = splitIso(end);
  if (!a || !b) return 0;
  return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86400000) + 1;
}

/** Today in the device's own calendar, as ISO. */
export function todayIso(now = new Date()) {
  return isoDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}
