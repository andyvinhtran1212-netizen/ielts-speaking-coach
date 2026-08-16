function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function count(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function cost(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function normalizeInstructor(value) {
  if (!value || typeof value !== 'object') return null;
  const instructorId = text(value.instructor_id);
  const students = count(value.students);
  const prompts = count(value.prompts);
  const graded = count(value.graded);
  const regraded = count(value.regraded);
  const regradeEvents = count(value.regrade_events);
  const tokens = count(value.tokens);
  const costUsd = cost(value.cost_usd);
  if (!instructorId
      || [students, prompts, graded, regraded, regradeEvents, tokens, costUsd].some((item) => item == null)
      || regraded > regradeEvents) return null;
  return {
    instructorId,
    email: text(value.email),
    displayName: text(value.display_name),
    students,
    prompts,
    graded,
    regraded,
    regradeEvents,
    tokens,
    costUsd,
  };
}

export function normalizeInstructorsPayload(value) {
  if (!Array.isArray(value)) return null;
  const rows = [];
  const seen = new Set();
  let malformedCount = 0;
  for (const raw of value) {
    const row = normalizeInstructor(raw);
    if (!row || seen.has(row.instructorId)) {
      malformedCount += 1;
      continue;
    }
    seen.add(row.instructorId);
    rows.push(row);
  }
  return { rows, malformedCount };
}

export function instructorLabel(row) {
  return row?.displayName || row?.email || row?.instructorId || 'Không rõ giảng viên';
}

export function filterInstructors(rows, query) {
  const needle = text(query)?.toLocaleLowerCase('vi-VN');
  if (!needle) return rows || [];
  return (rows || []).filter((row) => [row.displayName, row.email, row.instructorId]
    .some((value) => value?.toLocaleLowerCase('vi-VN').includes(needle)));
}

export function summarizeInstructors(rows) {
  return (rows || []).reduce((summary, row) => ({
    instructors: summary.instructors + 1,
    students: summary.students + row.students,
    graded: summary.graded + row.graded,
    costUsd: summary.costUsd + row.costUsd,
  }), { instructors: 0, students: 0, graded: 0, costUsd: 0 });
}

export function formatInstructorCount(value) {
  const number = count(value);
  return number == null ? '—' : number.toLocaleString('vi-VN');
}

export function formatInstructorCost(value) {
  const number = cost(value);
  return number == null ? '—' : `$${number.toFixed(4)}`;
}

export function instructorWorkspaceHref(instructorId) {
  const id = text(instructorId);
  return id ? `/instructor?as_instructor=${encodeURIComponent(id)}` : null;
}
