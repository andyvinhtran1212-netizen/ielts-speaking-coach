// "Buổi học và tài liệu lớp" (LEARNERCORE-0063 amendment 6, G07-T30c,
// FR-119…FR-125). Pure helpers for `/course/class`, kept here so node tests can
// pin them: the class picker, the default session, the Vietnam-time day labels,
// the YouTube host check, the teacher/schedule line, and the homework of a
// session matched by `lesson_id`.
//
// Sessions and their attachments are normalized by `normalizeMyClassResponse`
// of `my-class-model.mjs` (the `/my-class` rules, `http`/`https` only); this
// module does not re-validate them.

const VN_TZ = 'Asia/Ho_Chi_Minh';
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const START_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be']);

/** ISO weekday 1 = Thứ Hai … 7 = Chủ Nhật (mig 441 `weekly_schedule.dow`). */
export const DOW_LABELS = ['', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ Nhật'];

export const STATUS_LABELS = { past: 'Đã học', today: 'Hôm nay', upcoming: 'Sắp tới' };

const VN_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: VN_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
});

function objectOf(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** `YYYY-MM-DD` of an instant in Vietnam time. */
export function vnDay(instant) {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = Object.fromEntries(VN_PARTS.formatToParts(date).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/**
 * The calendar day of a session. `class_lessons.lesson_date` is a `date`
 * (already a calendar day); a full timestamp is read in Vietnam time.
 */
export function lessonDay(value) {
  const raw = textOf(value);
  if (!raw) return null;
  if (DAY_RE.test(raw)) return raw;
  const time = Date.parse(raw);
  return Number.isFinite(time) ? vnDay(new Date(time)) : null;
}

/** FR-121: `past` | `today` | `upcoming`, or `null` without a date. */
export function lessonStatus(lesson, today) {
  const day = lessonDay(lesson?.lessonDate);
  if (!day || !today) return null;
  if (day < today) return 'past';
  return day === today ? 'today' : 'upcoming';
}

/** "Thứ Tư 18/11/2026" for a session day. */
export function lessonDateLabel(value) {
  const day = lessonDay(value);
  const match = day ? DAY_RE.exec(day) : null;
  if (!match) return null;
  const [, year, month, date] = match;
  // Noon UTC is the same calendar day everywhere, so the weekday is exact.
  const dow = new Date(Date.UTC(Number(year), Number(month) - 1, Number(date), 12)).getUTCDay();
  return `${DOW_LABELS[dow === 0 ? 7 : dow]} ${date}/${month}/${year}`;
}

/** "Buổi n" (or only the date without `lesson_no`), FR-121. */
export function lessonHeading(lesson) {
  if (Number.isInteger(lesson?.lessonNo)) return `Buổi ${lesson.lessonNo}`;
  return lessonDateLabel(lesson?.lessonDate) || '';
}

/** FR-120: sessions published with a date before today (Vietnam time). */
export function learnedCount(lessons, today) {
  return (lessons || []).filter((lesson) => lessonStatus(lesson, today) === 'past').length;
}

/** FR-120: `?class=` when it is one of the learner's classes, else the first. */
export function pickClassId(classes, requested) {
  const ids = (classes || []).map((c) => c?.id).filter(Boolean);
  const wanted = textOf(requested);
  return wanted && ids.includes(wanted) ? wanted : ids[0] || null;
}

/** The selected class's sessions, in the order the API returned them. */
export function lessonsOfClass(lessons, classId, classCount) {
  const all = lessons || [];
  // A single-class learner's sessions may carry no cohort id in old rows.
  if (classCount <= 1) return all.filter((l) => !l.cohortId || l.cohortId === classId);
  return all.filter((l) => l.cohortId === classId);
}

/**
 * FR-121 default session: `?session=` when it belongs to the class, else the
 * "today" session, else the nearest upcoming one, else the last of the list.
 */
export function defaultLessonId(lessons, requested, today) {
  const list = lessons || [];
  if (!list.length) return null;
  const wanted = textOf(requested);
  if (wanted && list.some((l) => l.id === wanted)) return wanted;
  const todays = list.find((l) => lessonStatus(l, today) === 'today');
  if (todays) return todays.id;
  const upcoming = list
    .filter((l) => lessonStatus(l, today) === 'upcoming')
    .sort((a, b) => (lessonDay(a.lessonDate) < lessonDay(b.lessonDate) ? -1
      : lessonDay(a.lessonDate) > lessonDay(b.lessonDate) ? 1 : 0));
  if (upcoming.length) return upcoming[0].id;
  return list[list.length - 1].id;
}

/** FR-122: the four YouTube hosts only (never `youtube.com.evil.example`). */
export function isYouTubeUrl(url) {
  try {
    return YOUTUBE_HOSTS.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** FR-122: one row per attachment; a null `url` is the "cannot open" row. */
export function materialRows(attachments) {
  return (attachments || []).map((item, index) => {
    if (!item?.url) return { key: `m${index}`, kind: 'broken', label: item?.label || '' };
    const video = isYouTubeUrl(item.url);
    return {
      key: `m${index}`,
      kind: video ? 'youtube' : 'document',
      label: item.label,
      url: item.url,
      type: video ? 'Video · YouTube' : 'Tài liệu',
      action: video ? 'Xem trên YouTube' : 'Mở tài liệu',
    };
  });
}

function scheduleSlots(value) {
  if (!Array.isArray(value)) return [];
  const slots = [];
  for (const slot of value) {
    const row = objectOf(slot);
    const dow = row?.dow;
    const start = row?.start;
    if (!Number.isInteger(dow) || dow < 1 || dow > 7 || typeof start !== 'string' || !START_RE.test(start)) return [];
    slots.push({ dow, start });
  }
  return slots;
}

function joinDays(days) {
  if (days.length <= 1) return days.join('');
  return `${days.slice(0, -1).join(', ')} và ${days[days.length - 1]}`;
}

/**
 * FR-120 schedule line, by weekday: one start time → "Thứ Hai và Thứ Tư, 18:30"
 * ("Thứ Hai, Thứ Tư và Thứ Sáu, 18:30" for three or more); different times →
 * "Thứ Hai 18:30, Thứ Tư 19:00". `null` when there is nothing to show.
 */
export function scheduleLine(value) {
  const slots = scheduleSlots(value).sort((a, b) => a.dow - b.dow || (a.start < b.start ? -1 : 1));
  if (!slots.length) return null;
  const starts = new Set(slots.map((s) => s.start));
  if (starts.size === 1) return `${joinDays(slots.map((s) => DOW_LABELS[s.dow]))}, ${slots[0].start}`;
  return slots.map((s) => `${DOW_LABELS[s.dow]} ${s.start}`).join(', ');
}

/**
 * FR-120 teacher and schedule per class from the raw `/api/class/me` classes.
 * `class_meta` in `degraded` hides both lines (never "no teacher").
 */
export function classMeta(rawClasses, degraded) {
  const out = new Map();
  if ((degraded || []).includes('class_meta') || !Array.isArray(rawClasses)) return out;
  for (const raw of rawClasses) {
    const row = objectOf(raw);
    const id = textOf(row?.id);
    if (!id) continue;
    const name = textOf(objectOf(row.instructor)?.name);
    out.set(id, { teacher: name || null, schedule: scheduleLine(row.weekly_schedule) });
  }
  return out;
}

/** `{item_id: lesson_id}` from the raw `/api/student/assigned` items (FR-123). */
export function lessonLinks(rawItems) {
  const links = new Map();
  for (const raw of Array.isArray(rawItems) ? rawItems : []) {
    const row = objectOf(raw);
    const itemId = textOf(row?.item_id);
    const lessonId = textOf(row?.lesson_id);
    if (itemId && lessonId) links.set(itemId, lessonId);
  }
  return links;
}

/**
 * FR-123: the homework block of one session. `entries` are the assigned rows
 * of the selected class (`{ row: { itemId } }`). When no row of the class is
 * tied to any session, the block is hidden at every session (`show: false`),
 * so no session wrongly reads "no homework".
 */
export function homeworkFor(entries, links, lessonId) {
  const linked = (entries || []).filter((entry) => links.has(entry.row.itemId));
  if (!linked.length) return { show: false, rows: [] };
  return { show: true, rows: linked.filter((entry) => links.get(entry.row.itemId) === lessonId) };
}

/** The query string with `?class=` / `?session=` set, other params kept. */
export function selectionSearch(search, { classId, lessonId }) {
  const params = new URLSearchParams(search);
  if (classId) params.set('class', classId); else params.delete('class');
  if (lessonId) params.set('session', lessonId); else params.delete('session');
  const next = params.toString();
  return next ? `?${next}` : '';
}
