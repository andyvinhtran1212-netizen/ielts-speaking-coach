import {
  admitCorePlayer,
  admitCorePlayerFromLegacyUrl,
  corePlayerUrl,
} from './core-player-affinity.mjs';

const SKILLS = new Set(['speaking', 'writing', 'reading', 'listening', 'course']);
const PLAYER_SURFACES = new Set(['speaking', 'reading_exam', 'listening_test']);

function objectOf(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function optionalText(value) {
  if (value == null) return null;
  return typeof value === 'string' ? value : null;
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function timestamp(value) {
  if (value == null) return null;
  if (typeof value !== 'string' || !value.trim() || !Number.isFinite(Date.parse(value))) return undefined;
  return value;
}

function normalizeCourse(value) {
  if (value == null) return null;
  const row = objectOf(value);
  if (!row) return undefined;
  const code = textOf(row.code);
  const name = textOf(row.name);
  return code || name ? { code, name } : null;
}

function normalizeClass(value) {
  const row = objectOf(value);
  if (!row || !Object.keys(row).length) return null;
  const course = normalizeCourse(row.course);
  if (course === undefined) return undefined;
  return {
    id: textOf(row.id) || null,
    name: textOf(row.name) || null,
    description: optionalText(row.description),
    course,
  };
}

function safeHttpUrl(value) {
  const raw = textOf(value);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}

function normalizeAttachment(value) {
  const row = objectOf(value);
  if (!row) return null;
  const label = textOf(row.label);
  if (!label) return null;
  return { label, url: safeHttpUrl(row.url) };
}

function normalizeLesson(value) {
  const row = objectOf(value);
  if (!row) return null;
  const id = textOf(row.id);
  const title = textOf(row.title);
  const lessonNo = row.lesson_no == null ? null : nonNegativeInteger(row.lesson_no);
  const attachments = Array.isArray(row.attachments)
    ? row.attachments.map(normalizeAttachment)
    : row.attachments == null ? [] : null;
  if (!id || !title || lessonNo === null && row.lesson_no != null || !attachments
      || attachments.some((item) => !item)) return null;
  return {
    id,
    title,
    lessonNo,
    lessonDate: optionalText(row.lesson_date),
    bodyMarkdown: optionalText(row.body_md) || '',
    attachments,
  };
}

function normalizeAssignment(value) {
  const row = objectOf(value);
  const assignment = objectOf(row?.assignment);
  if (!row || !assignment) return null;
  const itemId = textOf(row.item_id);
  const assignmentId = textOf(assignment.id);
  const title = textOf(assignment.title);
  const skill = textOf(assignment.skill);
  const dueAt = timestamp(assignment.due_at);
  const submittedAt = timestamp(row.submitted_at);
  const passedAt = timestamp(row.passed_at);
  const score = row.score == null ? null : finiteNumber(row.score);
  const cfg = objectOf(assignment.content_config) || {};
  if (!itemId || !assignmentId || !title || !SKILLS.has(skill) || dueAt === undefined
      || submittedAt === undefined || passedAt === undefined || score === null && row.score != null
      || typeof row.is_late !== 'boolean' || typeof row.is_missing !== 'boolean'
      || !['boolean', 'object'].includes(typeof row.writing_expected)) return null;
  if (row.writing_expected !== null && typeof row.writing_expected !== 'boolean') return null;
  // These flags are server-derived facts, not independent labels. Accepting a
  // contradictory pair would render one task in both "missing" and "done" and
  // make the rhythm disagree with the canonical list.
  if ((submittedAt && row.is_missing) || (!submittedAt && row.is_late)) return null;
  return {
    itemId,
    state: textOf(row.state) || 'assigned',
    submittedAt,
    score,
    passedAt,
    writingExpected: row.writing_expected,
    isLate: row.is_late,
    isMissing: row.is_missing,
    assignment: {
      id: assignmentId,
      title,
      skill,
      instructions: optionalText(assignment.instructions),
      dueAt,
      content: {
        topic: optionalText(cfg.topic),
        mode: optionalText(cfg.mode),
        part: finiteNumber(cfg.part),
        testTitle: optionalText(cfg.test_title),
        lessonNo: finiteNumber(cfg.lesson_no),
      },
    },
  };
}

function normalizeProgress(value) {
  if (value == null) return null;
  const row = objectOf(value);
  if (!row) return undefined;
  const out = {
    total: nonNegativeInteger(row.total),
    submitted: nonNegativeInteger(row.submitted),
    todo: nonNegativeInteger(row.todo),
    missing: nonNegativeInteger(row.missing),
    late: nonNegativeInteger(row.late),
    onTimePct: row.on_time_pct == null ? null : nonNegativeInteger(row.on_time_pct),
  };
  if (Object.values(out).some((item) => item === null) && row.on_time_pct != null) return undefined;
  if ([out.total, out.submitted, out.todo, out.missing, out.late].some((item) => item === null)) {
    return undefined;
  }
  if (out.onTimePct != null && out.onTimePct > 100) return undefined;
  return out;
}

function progressMatchesAssignments(progress, assignments) {
  if (!progress) return false;
  const submitted = assignments.filter((row) => row.submittedAt).length;
  const late = assignments.filter((row) => row.isLate).length;
  const missing = assignments.filter((row) => row.isMissing).length;
  const onTimePct = submitted ? Math.round((submitted - late) / submitted * 100) : null;
  return progress.total === assignments.length
    && progress.submitted === submitted
    && progress.late === late
    && progress.missing === missing
    && progress.todo === assignments.length - submitted - missing
    && progress.onTimePct === onTimePct;
}

/** Strict boundary for the private, canonical `/api/class/me` snapshot. */
export function normalizeMyClassResponse(value) {
  const row = objectOf(value);
  if (!row || typeof row.has_class !== 'boolean') return null;
  if (!row.has_class) return { hasClass: false };

  const degraded = row.degraded == null ? [] : Array.isArray(row.degraded)
    && row.degraded.every((item) => typeof item === 'string')
    ? [...new Set(row.degraded)] : null;
  if (!degraded) return null;

  const classInfo = normalizeClass(row.class);
  const rawAssignments = Array.isArray(row.assignments) ? row.assignments : null;
  const assignments = rawAssignments?.map(normalizeAssignment) || null;
  const rawLessons = Array.isArray(row.lessons) ? row.lessons : null;
  const lessons = rawLessons?.map(normalizeLesson) || null;
  const progress = normalizeProgress(row.progress);
  if (classInfo === undefined || progress === undefined) return null;

  const warnings = [...degraded];
  const validAssignments = !warnings.includes('assignments')
    && assignments && assignments.every(Boolean) ? assignments : null;
  const validLessons = !warnings.includes('lessons')
    && lessons && lessons.every(Boolean) ? lessons : null;
  if (!validAssignments && !warnings.includes('assignments')) warnings.push('assignments_contract');
  if (!validLessons && !warnings.includes('lessons')) warnings.push('lessons_contract');
  const validProgress = validAssignments && progressMatchesAssignments(progress, validAssignments)
    ? progress : null;
  if (validAssignments && !validProgress && !warnings.includes('progress_contract')) {
    warnings.push('progress_contract');
  }

  return {
    hasClass: true,
    classInfo,
    assignments: validAssignments,
    lessons: validLessons,
    progress: validProgress,
    warnings,
  };
}

export function awaitingWriting(row) {
  return row?.assignment?.skill === 'course'
    && row.writingExpected === true && Boolean(row.passedAt) && !row.submittedAt;
}

/** One canonical action decision for both current and history groups. */
export function assignmentAction(row) {
  if (row?.assignment?.skill === 'course' && row.submittedAt) {
    return { kind: 'review', label: 'Xem kết quả' };
  }
  if (row?.assignment?.skill === 'speaking'
      && (row.submittedAt || (row.isMissing && row.state !== 'assigned'))) {
    return { kind: 'review', label: 'Xem lại bài' };
  }
  if (!row?.isMissing && !row?.submittedAt) {
    return { kind: 'start', label: awaitingWriting(row) ? 'Tiếp tục bài' : 'Làm bài' };
  }
  return null;
}

export function assignmentSubtitle(row) {
  const cfg = row?.assignment?.content || {};
  if (row?.assignment?.skill === 'speaking') {
    return [cfg.topic, cfg.part ? `Part ${cfg.part}` : ''].filter(Boolean).join(' · ');
  }
  if (row?.assignment?.skill === 'course') {
    return [cfg.lessonNo ? `Buổi ${cfg.lessonNo}` : '', cfg.testTitle]
      .filter(Boolean).join(' · ');
  }
  const labels = { writing: 'Writing', reading: 'Reading', listening: 'Listening' };
  return [labels[row?.assignment?.skill] || row?.assignment?.skill, cfg.testTitle]
    .filter(Boolean).join(' · ');
}

export function remainingLabel(milliseconds) {
  const total = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours} giờ ${String(minutes).padStart(2, '0')} phút`;
  if (minutes > 0) return `${minutes} phút ${String(seconds).padStart(2, '0')} giây`;
  return `${seconds} giây`;
}

export function nextDue(assignments) {
  return (assignments || [])
    .filter((row) => !row.submittedAt && row.assignment.dueAt && !row.isMissing)
    .map((row) => ({ row, at: Date.parse(row.assignment.dueAt) }))
    .filter((entry) => Number.isFinite(entry.at))
    .sort((left, right) => left.at - right.at)[0] || null;
}

function vnDay(date) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export function rhythmDays(assignments, now = new Date()) {
  const rank = { done: 0, late: 1, missing: 2 };
  const byDay = {};
  for (const row of assignments || []) {
    if (!row.assignment.dueAt) continue;
    const due = new Date(row.assignment.dueAt);
    if (!Number.isFinite(due.getTime())) continue;
    // `isMissing` is classified by the backend and is the same truth used by
    // the task groups and progress summary. The client clock only drives the
    // boundary refresh; it must not invent a competing assignment state.
    const state = row.submittedAt ? (row.isLate ? 'late' : 'done')
      : row.isMissing ? 'missing' : null;
    if (!state) continue;
    const day = vnDay(due);
    if (!byDay[day] || rank[state] < rank[byDay[day]]) byDay[day] = state;
  }
  const today = vnDay(now);
  return Array.from({ length: 14 }, (_, index) => {
    const day = vnDay(new Date(now.getTime() - (13 - index) * 86400000));
    return { day, state: byDay[day] || 'none', today: day === today };
  });
}

/** Validate `/start`; return a semantic destination rather than trusting a URL. */
export function normalizeClassStartResponse(value, expectedItemId) {
  const row = objectOf(value);
  if (!row || textOf(row.item_id) !== expectedItemId || !textOf(row.assignment_id)) return null;
  const skill = textOf(row.skill);
  if (!SKILLS.has(skill)) return null;

  const resultSessionId = textOf(row.result_session_id);
  if (resultSessionId && skill === 'speaking') {
    return { kind: 'result', url: `/result?id=${encodeURIComponent(resultSessionId)}` };
  }

  const sessionId = textOf(row.session_id);
  if (sessionId && skill === 'speaking') {
    // A NULL claim means the session was created but no stable player has
    // opened it yet, so runtime admission may still choose the current target.
    // Missing means an N-1 backend response: those sessions predate affinity
    // persistence and therefore belong to Legacy.
    if (row.renderer_affinity === null) {
      return { kind: 'player', surface: 'speaking', query: { session_id: sessionId } };
    }
    const implementation = Object.hasOwn(row, 'renderer_affinity')
      ? textOf(row.renderer_affinity)
      : 'legacy';
    try {
      return {
        kind: 'stable-player',
        url: corePlayerUrl('speaking', implementation, { session_id: sessionId }),
      };
    } catch {
      return null;
    }
  }
  const bankId = textOf(row.bank_id);
  if (bankId && skill === 'course') {
    if (row.review_only != null && typeof row.review_only !== 'boolean') return null;
    return {
      kind: 'course', bankId, itemId: expectedItemId,
      reviewOnly: row.review_only === true,
    };
  }

  const params = objectOf(row.session_params);
  if (params && skill === 'speaking') {
    const part = finiteNumber(params.part);
    const classItem = textOf(params.class_assignment_item_id);
    const mode = textOf(params.mode);
    const topic = textOf(params.topic);
    if (!Number.isInteger(part) || part < 1 || part > 3 || classItem !== expectedItemId
        || !mode || !topic) return null;
    return { kind: 'create-speaking', body: {
      mode, part, topic, class_assignment_item_id: classItem,
    } };
  }

  if (!['reading', 'listening'].includes(skill)) return null;
  const surface = skill === 'reading' ? 'reading_exam' : 'listening_test';
  const playerSurface = textOf(row.player_surface);
  const playerQuery = objectOf(row.player_query);
  if (playerSurface || playerQuery) {
    if (playerSurface !== surface || !playerQuery) return null;
    const queryKeys = Object.keys(playerQuery).sort();
    const identityKey = skill === 'reading' ? 'test_id' : 'id';
    if (queryKeys.join(',') !== ['class_item', identityKey].sort().join(',')) return null;
    const identity = textOf(playerQuery[identityKey]);
    const classItem = textOf(playerQuery.class_item);
    if (!identity || classItem !== expectedItemId) return null;
    try {
      return {
        kind: 'admission',
        url: admitCorePlayer(surface, { [identityKey]: identity, class_item: classItem }),
      };
    } catch {
      return null;
    }
  }

  // N-1 backend compatibility: old responses carried a stable Legacy path.
  // Re-enter runtime admission so those responses cannot pin a fresh attempt.
  const openUrl = textOf(row.open_url);
  if (!openUrl) return null;
  try {
    return {
      kind: 'admission',
      url: admitCorePlayerFromLegacyUrl(surface, openUrl, { class_item: expectedItemId }),
    };
  } catch {
    return null;
  }
}

export function isKnownPlayerSurface(value) {
  return PLAYER_SURFACES.has(value);
}
