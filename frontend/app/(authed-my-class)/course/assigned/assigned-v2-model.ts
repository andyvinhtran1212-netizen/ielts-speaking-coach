// "Bài được giao" v2 (LEARNERCORE-0063 amendment 3, FR-095…FR-099, FR-102).
//
// Pure helpers over `GET /api/student/assigned`. The server decides `group`,
// `action`, `accepting` and `self_practice_available` (FR-099: the page never
// derives the hand-in rule from the deadline); this module only validates the
// payload, sorts inside a group, writes the copy and filters in the browser.
import { normalizeClassAssignment } from '@/lib/my-class-model.mjs';

export type AssignedGroup = 'overdue' | 'todo' | 'awaiting_review' | 'returned';
export type AssignedAction = 'start' | 'resume' | 'review_submitted' | 'result' | 'self_practice' | 'none';
export type ClassRow = NonNullable<ReturnType<typeof normalizeClassAssignment>>;

export type AssignedItem = {
  row: ClassRow;
  group: AssignedGroup;
  action: AssignedAction;
  accepting: boolean;
  selfPractice: boolean;
};

export type Repractice = { key: string; title: string };

export type Assigned = {
  hasClass: boolean;
  items: AssignedItem[];
  repractice: Repractice[];
  stale: boolean;
  degraded: Set<'items' | 'repractice'>;
};

/** FR-096: fixed order, labels from the spec. */
export const GROUPS: readonly { key: AssignedGroup; label: string }[] = [
  { key: 'overdue', label: 'Quá hạn' },
  { key: 'todo', label: 'Cần làm' },
  { key: 'awaiting_review', label: 'Chờ giáo viên duyệt' },
  { key: 'returned', label: 'Đã trả' },
];

/** FR-097: one button per action; `none` has no button. */
export const ACTION_LABELS: Record<Exclude<AssignedAction, 'none'>, string> = {
  start: 'Làm bài',
  resume: 'Làm tiếp',
  review_submitted: 'Xem bài đã nộp',
  result: 'Xem kết quả',
  self_practice: 'Tự luyện bài này',
};

const SKILL_LABELS: Record<string, string> = {
  writing: 'Writing',
  speaking: 'Speaking',
  listening: 'Listening',
  reading: 'Reading',
  grammar: 'Ngữ pháp',
  course: 'Bài trong khoá',
};
const SKILL_ORDER = ['writing', 'speaking', 'listening', 'reading', 'grammar', 'course'];

const GROUP_KEYS = new Set<string>(GROUPS.map((g) => g.key));
const ACTION_KEYS = new Set<string>([...Object.keys(ACTION_LABELS), 'none']);
const DEGRADED_KEYS = new Set(['items', 'repractice']);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function item(value: unknown): AssignedItem | null {
  const raw = record(value);
  const row = raw ? normalizeClassAssignment(raw) : null;
  if (!raw || !row) return null;
  const group = text(raw.group);
  const action = text(raw.action);
  if (!GROUP_KEYS.has(group) || !ACTION_KEYS.has(action)
      || typeof raw.accepting !== 'boolean' || typeof raw.self_practice_available !== 'boolean') return null;
  return {
    row,
    group: group as AssignedGroup,
    action: action as AssignedAction,
    accepting: raw.accepting,
    selfPractice: raw.self_practice_available,
  };
}

/** `null` when the payload breaks the contract; a row that breaks it is dropped. */
export function normalizeAssigned(value: unknown): Assigned | null {
  const body = record(value);
  if (!body || typeof body.has_class !== 'boolean' || !Array.isArray(body.items)) return null;
  const degraded = new Set<'items' | 'repractice'>();
  for (const key of Array.isArray(body.degraded) ? body.degraded : []) {
    if (DEGRADED_KEYS.has(key as string)) degraded.add(key as 'items' | 'repractice');
  }
  const repractice: Repractice[] = [];
  for (const [index, entry] of (Array.isArray(body.repractice) ? body.repractice : []).entries()) {
    const grant = record(entry);
    const title = text(grant?.title) || text(grant?.course_title);
    if (title) repractice.push({ key: text(grant?.code) || `${index}`, title });
  }
  return {
    hasClass: body.has_class,
    items: body.items.map(item).filter((entry): entry is AssignedItem => entry !== null),
    repractice,
    stale: body.homework_stale === true,
    degraded,
  };
}

const VN_DATE_TIME = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
});

/** "20:00, 20/11" in Vietnam time (FR-097), as on the sheet. */
export function vnDateTime(value: string | null | undefined): string | null {
  const time = Date.parse(value || '');
  if (!Number.isFinite(time)) return null;
  const parts = Object.fromEntries(VN_DATE_TIME.formatToParts(new Date(time)).map((p) => [p.type, p.value]));
  return `${parts.hour}:${parts.minute}, ${parts.day}/${parts.month}`;
}

export function skillLabel(skill: string): string {
  return SKILL_LABELS[skill] || skill;
}

/** The status in words (FR-097, FR-099). */
export function statusCopy(entry: AssignedItem): string {
  switch (entry.group) {
    case 'overdue':
      return entry.accepting ? 'Quá hạn' : 'Không còn nhận bài';
    case 'todo':
      return entry.row.state === 'opened' || entry.row.courseAction === 'continue' ? 'Đang làm' : 'Chưa làm';
    case 'awaiting_review':
      return 'Chờ giáo viên duyệt';
    default:
      return 'Đã trả kết quả';
  }
}

/** "Nộp trễ n ngày" for a late hand-in, n counted in whole days, at least 1. */
export function lateCopy(row: ClassRow): string | null {
  if (!row.isLate || !row.submittedAt || !row.assignment.dueAt) return null;
  const late = Date.parse(row.submittedAt) - Date.parse(row.assignment.dueAt);
  if (!Number.isFinite(late)) return 'Nộp trễ';
  return `Nộp trễ ${Math.max(1, Math.ceil(late / 86_400_000))} ngày`;
}

// Skills whose ledger `score` is an IELTS band (the session's overall band for
// Speaking), as the legacy tree shows it. Course and grammar scores are
// percentages, never labelled as a band.
const SCORE_IS_BAND = new Set(['speaking', 'listening', 'reading']);

/**
 * Band only when the server sends one, in "Đã trả": Writing reads `band`, which
 * the server sends only once the essay is returned (FR-077); Speaking,
 * Listening and Reading read the returned `score`.
 */
export function bandCopy(entry: AssignedItem): string | null {
  if (entry.group !== 'returned') return null;
  const { row } = entry;
  const band = row.assignment.skill === 'writing' ? row.band
    : SCORE_IS_BAND.has(row.assignment.skill) ? row.score : null;
  return typeof band === 'number' ? `Band ${band}` : null;
}

function time(value: string | null | undefined, fallback: number): number {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * FR-096: to-do and overdue by nearest deadline (none last); handed-in groups
 * by newest hand-in.
 */
export function sortGroup(group: AssignedGroup, items: readonly AssignedItem[]): AssignedItem[] {
  const list = [...items];
  if (group === 'overdue' || group === 'todo') {
    list.sort((a, b) => time(a.row.assignment.dueAt, Infinity) - time(b.row.assignment.dueAt, Infinity));
  } else {
    list.sort((a, b) => time(b.row.submittedAt, -Infinity) - time(a.row.submittedAt, -Infinity));
  }
  return list;
}

/** The number on the "Bài được giao" card: work not handed in that the server still takes. */
export function openCount(items: readonly AssignedItem[]): number {
  return items.filter((entry) => entry.group === 'todo' || (entry.group === 'overdue' && entry.accepting)).length;
}

// ── filters (FR-098) ──────────────────────────────────────────────────────────

export type Filters = { skill: string; state: string };
export const ALL = 'all';

export type FilterOption = { value: string; label: string };

/** Options with counts over the whole list (not narrowed by the other filter). */
export function skillOptions(items: readonly AssignedItem[]): FilterOption[] {
  const counts = new Map<string, number>();
  for (const entry of items) counts.set(entry.row.assignment.skill, (counts.get(entry.row.assignment.skill) || 0) + 1);
  const skills = [...counts.keys()].sort((a, b) => SKILL_ORDER.indexOf(a) - SKILL_ORDER.indexOf(b));
  return [
    { value: ALL, label: `Tất cả (${items.length})` },
    ...skills.map((skill) => ({ value: skill, label: `${skillLabel(skill)} (${counts.get(skill)})` })),
  ];
}

export function stateOptions(items: readonly AssignedItem[]): FilterOption[] {
  return [
    { value: ALL, label: `Tất cả (${items.length})` },
    ...GROUPS.map((g) => ({ g, n: items.filter((entry) => entry.group === g.key).length }))
      .filter(({ n }) => n > 0)
      .map(({ g, n }) => ({ value: g.key, label: `${g.label} (${n})` })),
  ];
}

/** Read `?skill=` / `?state=`; anything not offered falls back to "all". */
export function readFilters(search: string, items: readonly AssignedItem[]): Filters {
  const params = new URLSearchParams(search);
  const skill = params.get('skill') || ALL;
  const state = params.get('state') || ALL;
  return {
    skill: skillOptions(items).some((o) => o.value === skill) ? skill : ALL,
    state: stateOptions(items).some((o) => o.value === state) ? state : ALL,
  };
}

/** The query string for the filters, other params kept. */
export function filtersSearch(search: string, filters: Filters): string {
  const params = new URLSearchParams(search);
  for (const key of ['skill', 'state'] as const) {
    if (filters[key] === ALL) params.delete(key);
    else params.set(key, filters[key]);
  }
  const next = params.toString();
  return next ? `?${next}` : '';
}

export function applyFilters(items: readonly AssignedItem[], filters: Filters): AssignedItem[] {
  return items.filter((entry) => (filters.skill === ALL || entry.row.assignment.skill === filters.skill)
    && (filters.state === ALL || entry.group === filters.state));
}

export function isFiltering(filters: Filters): boolean {
  return filters.skill !== ALL || filters.state !== ALL;
}

/** "Hiện N trên M bài" while filtering, "Cả M bài" otherwise; never "0/0". */
export function resultLine(shown: number, total: number, filtering: boolean): string {
  return filtering ? `Hiện ${shown} trên ${total} bài` : `Cả ${total} bài`;
}
