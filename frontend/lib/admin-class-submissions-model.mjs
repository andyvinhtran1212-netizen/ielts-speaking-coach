const object = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const text = (value) => typeof value === 'string' ? value : '';
const nullableText = (value) => text(value).trim() || null;
const finite = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;

export function normalizeTally(value) {
  const payload = object(value);
  const assignment = object(payload.assignment);
  const counts = object(payload.counts);
  if (!text(assignment.id) || !text(assignment.title) || !text(assignment.skill) || !Array.isArray(payload.students)) return null;
  const students = payload.students.map((item) => {
    const row = object(item);
    const id = text(row.student_id);
    if (!id) return null;
    return {
      student_id: id, name: text(row.name), student_code: nullableText(row.student_code),
      status: text(row.status) || 'pending', submitted_at: nullableText(row.submitted_at),
      score: finite(row.score), flags: Array.isArray(row.flags) ? row.flags.map((flag) => {
        const f = object(flag);
        return { code: text(f.code), severity: text(f.severity), label: text(f.label), why: text(f.why), action: text(f.action) };
      }) : [], flag_level: nullableText(row.flag_level), passed_at: nullableText(row.passed_at),
      course_state: nullableText(row.course_state), next_action: nullableText(row.next_action),
      pass_pct: finite(row.pass_pct), near_pass_pct: finite(row.near_pass_pct),
      sections_done: Math.max(0, finite(row.sections_done) || 0), sections_total: Math.max(0, finite(row.sections_total) || 0),
      missing_sections: Array.isArray(row.missing_sections) ? row.missing_sections.map((value) => { const section = object(value); return { key: text(section.key), label: text(section.label) || text(section.key) }; }).filter((section) => section.key) : [],
      retakes: Math.max(0, finite(row.retakes) || 0), verdicts: Math.max(0, finite(row.verdicts) || 0),
      artifact_kind: nullableText(row.artifact_kind), artifact_id: nullableText(row.artifact_id),
      has_writing: row.has_writing === true, writing_expected: row.writing_expected === true,
    };
  }).filter(Boolean);
  return {
    assignment: { id: assignment.id, title: assignment.title, skill: assignment.skill, due_at: nullableText(assignment.due_at) },
    sealed: payload.sealed === true, homework_stale: payload.homework_stale === true,
    sections_shape_unknown: payload.sections_shape_unknown === true,
    writing_total: Math.max(0, finite(payload.writing_total) || 0), students,
    counts: {
      total: Math.max(0, finite(counts.total) || 0), submitted: Math.max(0, finite(counts.submitted) || 0),
      late: Math.max(0, finite(counts.late) || 0), missing: Math.max(0, finite(counts.missing) || 0),
      no_account: Math.max(0, finite(counts.no_account) || 0), flagged: Math.max(0, finite(counts.flagged) || 0),
      passed: Math.max(0, finite(counts.passed) || 0), near_pass: Math.max(0, finite(counts.near_pass) || 0),
      retry_full: Math.max(0, finite(counts.retry_full) || 0), in_progress: Math.max(0, finite(counts.in_progress) || 0),
      untouched: Math.max(0, finite(counts.untouched) || 0),
    },
  };
}

export function normalizeEffort(value) {
  const payload = object(value);
  if (!Array.isArray(payload.students) || !Array.isArray(payload.axes)) return null;
  return {
    stale: payload.stale === true, stages_total: Math.max(0, finite(payload.stages_total) || 0),
    writing_total: Math.max(0, finite(payload.writing_total) || 0),
    students: payload.students.map((item) => {
      const row = object(item);
      const studentId = nullableText(row.student_id);
      const userId = nullableText(row.user_id);
      if (!studentId && !userId) return null;
      return {
        student_id: studentId, user_id: userId, state: text(row.state) || 'untouched',
        wrote: row.wrote === true, stages_done: Math.max(0, finite(row.stages_done) || 0),
        minutes: finite(row.minutes), questions: Math.max(0, finite(row.questions) || 0),
        correct: Math.max(0, finite(row.correct) || 0), accuracy: finite(row.accuracy),
        median_sec: finite(row.median_sec), idle_sec: Math.max(0, finite(row.idle_sec) || 0), last_at: nullableText(row.last_at),
        attempts: Math.max(0, finite(row.attempts) || 0), combined_pct: finite(row.combined_pct),
        next_action: nullableText(row.next_action), pass_pct: finite(row.pass_pct), near_pass_pct: finite(row.near_pass_pct),
        sections_done: Math.max(0, finite(row.sections_done) || 0), sections_total: Math.max(0, finite(row.sections_total) || 0),
        attempt_minutes: Math.max(0, finite(row.attempt_minutes) || 0), current_attempt_minutes: Math.max(0, finite(row.current_attempt_minutes) || 0),
        section_results: Array.isArray(row.section_results) ? row.section_results.map((value) => {
          const section = object(value);
          return { key: text(section.key), label: text(section.label) || text(section.key), pct: finite(section.pct), duration_sec: Math.max(0, finite(section.duration_sec) || 0), carried: section.carried === true };
        }).filter((section) => section.key) : [],
        missing_sections: Array.isArray(row.missing_sections) ? row.missing_sections.map((value) => { const section = object(value); return { key: text(section.key), label: text(section.label) || text(section.key) }; }).filter((section) => section.key) : [],
        flags: Array.isArray(row.flags) ? row.flags.map((value) => { const flag = object(value); return { code: text(flag.code), severity: text(flag.severity), label: text(flag.label), why: text(flag.why), action: text(flag.action) }; }) : [],
      };
    }).filter(Boolean),
    axes: payload.axes.map((item) => {
      const row = object(item);
      const studentSample = Math.max(0, finite(row.student_sample) || 0);
      return { axis: text(row.axis), wrong: Math.max(0, finite(row.wrong) || 0), attempted: Math.max(0, finite(row.attempted) || 0), wrong_rate: finite(row.wrong_rate), affected_students: Math.max(0, finite(row.affected_students) || 0), student_sample: studentSample, affected_rate: finite(row.affected_rate), median_sec: finite(row.median_sec), scope: text(row.scope), sample_low: row.sample_low === true || (studentSample > 0 && studentSample < 3) };
    }).filter((row) => row.axis),
  };
}

export function normalizeStudentReport(value) {
  const payload = object(value);
  if (!Array.isArray(payload.questions) || !Array.isArray(payload.history)) return null;
  const totals = object(payload.totals);
  const summary = object(payload.summary);
  return {
    stale: payload.stale === true, locked: payload.locked === true, threshold: finite(payload.threshold),
    totals: { answered: finite(totals.answered) || 0, correct: finite(totals.correct) || 0, median_sec: finite(totals.median_sec), active_sec: finite(totals.active_sec), idle_sec: finite(totals.idle_sec), bank_title: nullableText(totals.bank_title), scope: text(totals.scope) },
    summary: { pass_pct: finite(summary.pass_pct), near_pass_pct: finite(summary.near_pass_pct), latest_pct: finite(summary.latest_pct), latest_action: nullableText(summary.latest_action), latest_attempt_number: finite(summary.latest_attempt_number), baseline_quiz_pct: finite(summary.baseline_quiz_pct), baseline_correct: Math.max(0, finite(summary.baseline_correct) || 0), baseline_answered: Math.max(0, finite(summary.baseline_answered) || 0), latest_sections: Array.isArray(summary.latest_sections) ? summary.latest_sections.map((value) => { const section = object(value); return { key: text(section.key), label: text(section.label) || text(section.key), pct: finite(section.pct), duration_sec: Math.max(0, finite(section.duration_sec) || 0), carried: section.carried === true }; }).filter((section) => section.key) : [] },
    history: payload.history.map((item, index) => {
      const row = object(item);
      return { number: finite(row.number) || index + 1, phase: text(row.phase), session_count: finite(row.session_count) || 0, pct: finite(row.pct), next_action: text(row.next_action), at: nullableText(row.at), completed: row.completed !== false, duration_sec: Math.max(0, finite(row.duration_sec) || 0), sections: Array.isArray(row.sections) ? row.sections.map((value) => { const section = object(value); return { key: text(section.key), label: text(section.label) || text(section.key), pct: finite(section.pct), duration_sec: Math.max(0, finite(section.duration_sec) || 0), carried: section.carried === true }; }).filter((section) => section.key) : [] };
    }),
    questions: payload.questions.map((item) => {
      const row = object(item);
      return { qid: nullableText(row.qid), item_key: text(row.item_key) || text(row.subtype) || 'Khác', prompt: text(row.prompt), picked: finite(row.picked), picked_text: nullableText(row.picked_text), answer: finite(row.answer), answer_text: nullableText(row.answer_text), is_correct: row.is_correct === true, why_wrong: nullableText(row.why_wrong), explain: nullableText(row.explain), seconds: finite(row.seconds) };
    }),
  };
}

export function normalizeWriting(value) {
  const payload = object(value);
  const student = object(payload.student);
  const assignment = object(payload.assignment);
  if (!text(student.id) || !text(assignment.id) || !Object.prototype.hasOwnProperty.call(payload, 'submission')) return null;
  if (payload.submission == null) return { student: { id: student.id, name: text(student.name), code: nullableText(student.code) }, assignment: { id: assignment.id, title: text(assignment.title) }, submission: null };
  const submission = object(payload.submission);
  if (!Array.isArray(submission.items)) return null;
  return {
    student: { id: student.id, name: text(student.name), code: nullableText(student.code) },
    assignment: { id: assignment.id, title: text(assignment.title) },
    submission: { clean: finite(submission.clean) || 0, total: finite(submission.total) || 0, model: nullableText(submission.model), graded_at: nullableText(submission.graded_at), items: submission.items.map((item) => object(item)) },
  };
}

export function groupReportQuestions(questions) {
  const groups = new Map();
  for (const question of questions || []) {
    const key = question.item_key || 'Khác';
    if (!groups.has(key)) groups.set(key, { axis: key, items: [], wrong: 0 });
    const group = groups.get(key);
    group.items.push(question);
    if (!question.is_correct) group.wrong += 1;
  }
  return [...groups.values()].map((group) => ({ ...group, total: group.items.length, rate: group.items.length ? group.wrong / group.items.length : 0 })).sort((a, b) => b.wrong - a.wrong || b.total - a.total);
}

export function canReturnSubmission(assignmentStatus, sealed) {
  return assignmentStatus === 'published' && sealed === false;
}
