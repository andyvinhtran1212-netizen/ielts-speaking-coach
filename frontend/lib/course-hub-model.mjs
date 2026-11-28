// Lộ trình page model (LEARNERCORE-0063 amendment 1, FR-030…FR-037).
// Pure functions over `GET /api/student/course` and the COURSELESSON-0064
// lessons response; the component only draws what these return.

const DEGRADABLE = new Set(['online', 'other_products', 'class', 'assigned_open']);
const LESSON_STATES = { done: 'Đã xong', current: 'Đang học', next: 'Tiếp theo', todo: 'Chưa làm' };

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function int(value) {
  return Number.isInteger(value) ? value : null;
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function onlineRow(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const code = text(raw.course_code);
  if (!code || (raw.state !== 'active' && raw.state !== 'expired')) return null;
  const done = int(raw.progress?.done);
  const total = int(raw.progress?.total);
  return {
    code,
    slug: text(raw.product_slug),
    title: text(raw.title) || code,
    expired: raw.state === 'expired',
    daysLeft: raw.state === 'active' ? int(raw.days_left) : null,
    canRenew: raw.can_renew === true,
    progress: done !== null && total !== null && total > 0 ? { done, total } : null,
    creditsLeft: int(raw.credits_left),
  };
}

/** The page payload, or null when it is outside the contract. */
export function normalizeCourse(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!Array.isArray(value.online) || typeof value.has_class !== 'boolean') return null;
  const klass = value.class && typeof value.class === 'object' ? value.class : null;
  return {
    online: value.online.map(onlineRow).filter(Boolean),
    others: list(value.other_products).flatMap((raw) => {
      const slug = text(raw?.slug);
      if (!slug || (raw.status !== 'open' && raw.status !== 'coming_soon')) return [];
      return [{ slug, title: text(raw.title) || slug, comingSoon: raw.status === 'coming_soon' }];
    }),
    klass: klass ? {
      name: text(klass.name),
      teacher: text(klass.teacher_name),
      courseTitle: text(klass.course_title),
      repractice: list(klass.repractice).flatMap((raw) => {
        const code = text(raw?.course_code);
        return code ? [{ code, title: text(raw.title) || code }] : [];
      }),
    } : null,
    assignedOpen: Math.max(0, int(value.assigned_open) ?? 0),
    hasClass: value.has_class === true && Boolean(klass),
    selected: text(value.selected),
    degraded: new Set(list(value.degraded).filter((key) => DEGRADABLE.has(key))),
  };
}

/** FR-035: a class learner with no online grant at all goes to the assigned work. */
export function shouldRedirectToAssigned(course) {
  return course.hasClass && course.online.length === 0
    && !course.degraded.has('online') && !course.degraded.has('class');
}

/** "Bài được giao (n)"; n = 0 shows no number (FR-030). */
export function assignedCardLabel(count) {
  return count > 0 ? `Bài được giao (${count})` : 'Bài được giao';
}

/** One meta line of an online row (FR-031, FR-037). */
export function onlineMeta(row) {
  const parts = [];
  if (row.expired) parts.push('Đã hết hạn');
  else if (row.daysLeft !== null) parts.push(`còn ${row.daysLeft} ngày`);
  if (row.progress) parts.push(`${row.progress.done}/${row.progress.total} bài`);
  if (row.creditsLeft !== null) parts.push(`Còn ${row.creditsLeft} lượt chấm AI`);
  return parts.join(' · ');
}

/** Class line: "Lớp A · giáo viên Cô Lan · IELTS 6.5", missing parts left out. */
export function classMeta(klass) {
  return [
    klass.name ? `Lớp ${klass.name}` : null,
    klass.teacher ? `giáo viên ${klass.teacher}` : null,
    klass.courseTitle,
  ].filter(Boolean).join(' · ');
}

/**
 * The course whose lessons are listed (FR-034): `?course=` when it names a
 * course on the page, else the server's choice, else the first online course,
 * else a class re-practice course.
 */
export function selectedCourse(course, requested) {
  const codes = [...course.online.map((row) => row.code),
    ...(course.klass?.repractice ?? []).map((row) => row.code)];
  if (requested && codes.includes(requested)) return requested;
  if (course.selected && codes.includes(course.selected)) return course.selected;
  return codes[0] ?? null;
}

export function lessonStateCopy(state) {
  return LESSON_STATES[state] ?? null;
}

/** Stages with at least one lesson; null when the response is outside the contract. */
export function normalizeLessons(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.stages)) return null;
  const stages = value.stages.flatMap((stage) => {
    const lessons = list(stage?.lessons).flatMap((raw) => {
      const code = text(raw?.lesson_code);
      if (!code) return [];
      return [{
        code,
        no: int(raw.lesson_no),
        title: text(raw.title) || code,
        state: lessonStateCopy(raw.state) ?? 'Chưa làm',
        gate: text(raw.gate?.text_vi),
      }];
    });
    return lessons.length ? [{ no: int(stage.stage_no), title: text(stage.title), lessons }] : [];
  });
  return { comingSoon: value.coming_soon === true || stages.length === 0, stages };
}

/** How a lessons call failed: `expired` (403 course_access_expired), `soon` (404), else `error`. */
export function lessonsFailure(caught) {
  const status = caught?.status;
  const code = caught?.code ?? caught?.detail?.error_code ?? null;
  if (status === 403 && code === 'course_access_expired') return 'expired';
  if (status === 404) return 'soon';
  return 'error';
}
