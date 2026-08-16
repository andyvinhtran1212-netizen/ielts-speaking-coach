function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function text(value) {
  return typeof value === 'string' ? value : '';
}

function nullableText(value) {
  const out = text(value).trim();
  return out || null;
}

function finite(value) {
  if (value == null || value === '') return null;
  const out = Number(value);
  return Number.isFinite(out) ? out : null;
}

function count(value) {
  return Math.max(0, finite(value) || 0);
}

function fold(value) {
  return text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLocaleLowerCase('vi-VN');
}

export function normalizeAssignmentsPayload(value) {
  const payload = object(value);
  if (!Array.isArray(payload.assignments)) return null;
  const assignments = payload.assignments.map((item) => {
    const row = object(item);
    const id = text(row.id);
    const skill = text(row.skill);
    if (!id || !['speaking', 'reading', 'listening', 'course'].includes(skill)) return null;
    const candidateProgress = row.progress == null ? null : object(row.progress);
    const rawProgress = candidateProgress
      && ['assigned', 'submitted', 'late', 'missing'].every((key) => finite(candidateProgress[key]) != null)
      ? candidateProgress : null;
    return {
      id,
      title: text(row.title) || 'Bài giao chưa đặt tên',
      skill,
      kind: row.kind === 'lesson' ? 'lesson' : 'daily',
      status: row.status === 'archived' ? 'archived' : 'published',
      due_at: nullableText(row.due_at),
      content_id: nullableText(row.content_id),
      content_config: object(row.content_config),
      recipient_scope: row.recipient_scope === 'subset' ? 'subset' : 'class',
      created_at: nullableText(row.created_at),
      progress: rawProgress == null ? null : {
        assigned: count(rawProgress.assigned),
        submitted: count(rawProgress.submitted),
        late: count(rawProgress.late),
        missing: count(rawProgress.missing),
        no_account: count(rawProgress.no_account),
      },
    };
  }).filter(Boolean);
  return {
    assignments,
    reconcile_failed: payload.reconcile_failed === true,
  };
}

export function assignmentSummary(assignments, nowValue = Date.now()) {
  const rows = Array.isArray(assignments) ? assignments : [];
  const dueSoon = nowValue + 48 * 60 * 60 * 1000;
  const isOverdue = (row) => {
    const at = row?.due_at ? Date.parse(row.due_at) : Number.NaN;
    return row?.status !== 'archived' && Number.isFinite(at) && at < nowValue;
  };
  const isSoon = (row) => {
    const at = row?.due_at ? Date.parse(row.due_at) : Number.NaN;
    return row?.status !== 'archived' && Number.isFinite(at) && at >= nowValue && at <= dueSoon;
  };
  return {
    open: rows.filter((row) => row.status !== 'archived' && !isOverdue(row)).length,
    dueSoon: rows.filter(isSoon).length,
    closed: rows.filter((row) => row.status === 'archived').length,
  };
}

export function selectAssignments(assignments, filters = {}, nowValue = Date.now()) {
  const query = fold(text(filters.search).trim());
  const status = text(filters.status) || 'all';
  const soon = nowValue + 48 * 60 * 60 * 1000;
  return (Array.isArray(assignments) ? assignments : []).filter((row) => {
    const at = row.due_at ? Date.parse(row.due_at) : Number.NaN;
    const overdue = row.status !== 'archived' && Number.isFinite(at) && at < nowValue;
    const dueSoon = row.status !== 'archived' && Number.isFinite(at) && at >= nowValue && at <= soon;
    if (status === 'open' && (row.status === 'archived' || overdue)) return false;
    if (status === 'due-soon' && !dueSoon) return false;
    if (status === 'archived' && row.status !== 'archived') return false;
    const cfg = object(row.content_config);
    const haystack = fold(`${row.title} ${row.skill} ${text(cfg.topic)} ${text(cfg.test_title)}`);
    return !query || haystack.includes(query);
  });
}

export function defaultVietnamDueDate(at = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
  }).formatToParts(at).reduce((out, part) => ({ ...out, [part.type]: part.value }), {});
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  if (Number(parts.hour) < 19) return day;
  const anchor = new Date(`${day}T12:00:00Z`);
  anchor.setUTCDate(anchor.getUTCDate() + 1);
  return anchor.toISOString().slice(0, 10);
}

export function homeworkDraft(at = new Date()) {
  return {
    kind: 'daily', skill: 'speaking', title: '', contentId: '', mode: 'practice', part: '1',
    questionMode: 'random', questionIds: [], dueDate: defaultVietnamDueDate(at), dueTime: '19:00',
    dueDays: '7', instructions: '', recipientScope: 'class', studentIds: [], passPct: '', retakeSize: '', error: '',
  };
}

export function validateHomeworkDraft(draft, catalog = [], questions = [], questionsPerGive = 1) {
  const title = text(draft?.title).trim();
  if (!title) return { ok: false, error: 'Nhập tên bài giao để tiếp tục.' };
  const contentId = text(draft?.contentId);
  const selected = (Array.isArray(catalog) ? catalog : []).find((item) => item.id === contentId);
  if (!contentId || !selected) return { ok: false, error: 'Chọn nội dung bài tập để tiếp tục.' };
  if (!selected.ready || selected.already_given) return { ok: false, error: selected.reason || 'Nội dung này chưa giao được.' };
  if (draft.recipientScope === 'subset' && !draft.studentIds?.length) return { ok: false, error: 'Chọn ít nhất một học viên nhận bài.' };
  if (draft.kind === 'lesson') {
    const dueDays = Number(draft.dueDays);
    if (!Number.isInteger(dueDays) || dueDays < 1 || dueDays > 90) return { ok: false, error: 'Số ngày được nộp phải từ 1 đến 90.' };
  }
  if (draft.kind !== 'lesson' && draft.dueDate) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(draft.dueDate);
    const parsed = match ? new Date(`${draft.dueDate}T00:00:00Z`) : null;
    if (!match || !parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== draft.dueDate) return { ok: false, error: 'Ngày hạn không hợp lệ.' };
  }
  if (draft.dueTime) {
    const match = /^(\d{2}):(\d{2})$/.exec(draft.dueTime);
    if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return { ok: false, error: 'Giờ hạn không hợp lệ.' };
  }
  if (draft.skill === 'course') {
    const pass = draft.passPct === '' ? null : Number(draft.passPct);
    const retake = draft.retakeSize === '' ? null : Number(draft.retakeSize);
    if (pass != null && (!Number.isInteger(pass) || pass < 50 || pass > 100)) return { ok: false, error: 'Ngưỡng đạt phải trong khoảng 50–100%.' };
    if (retake != null && (!Number.isInteger(retake) || retake < 5 || retake > 100)) return { ok: false, error: 'Số câu kiểm tra lại phải trong khoảng 5–100.' };
  }
  if (draft.questionMode === 'manual' && draft.skill === 'speaking' && draft.kind === 'daily') {
    const ready = new Set((Array.isArray(questions) ? questions : []).filter((item) => item.ready).map((item) => item.id));
    if (draft.questionIds.length !== questionsPerGive || draft.questionIds.some((id) => !ready.has(id))) {
      return { ok: false, error: `Chọn đúng ${questionsPerGive} câu đã sẵn sàng.` };
    }
  }
  if (draft.questionMode === 'manual' && draft.kind === 'lesson') {
    const ready = new Set((Array.isArray(questions) ? questions : []).filter((item) => item.ready).map((item) => item.id));
    if (!draft.questionIds.length || draft.questionIds.some((id) => !ready.has(id))) {
      return { ok: false, error: 'Chọn ít nhất một câu đã sẵn sàng trong bộ đề.' };
    }
  }
  const body = {
    skill: draft.kind === 'lesson' ? 'speaking' : draft.skill,
    kind: draft.kind,
    title,
    content_id: contentId,
    due_time: draft.dueTime || null,
    instructions: nullableText(draft.instructions),
    student_ids: draft.recipientScope === 'subset' ? [...draft.studentIds] : null,
  };
  if (draft.kind === 'lesson') {
    body.mode = draft.mode;
    body.due_days = Number(draft.dueDays);
    body.question_ids = draft.questionMode === 'manual' ? [...draft.questionIds] : null;
  } else {
    body.due_date = draft.dueDate || null;
    if (draft.skill === 'speaking') {
      body.topic = selected.title;
      body.mode = draft.mode;
      body.part = Number(draft.part);
      body.question_ids = draft.questionMode === 'manual' ? [...draft.questionIds] : null;
    }
    if (draft.skill === 'course') {
      if (draft.passPct !== '') body.pass_pct = Number(draft.passPct);
      if (draft.retakeSize !== '') body.retake_size = Number(draft.retakeSize);
    }
  }
  return { ok: true, body };
}

export function normalizeCatalog(value, kind, requestedSkill = '') {
  const payload = object(value);
  if (!Array.isArray(payload.items)) return null;
  if (kind === 'exam' && Array.isArray(payload.failed_kinds) && payload.failed_kinds.includes(requestedSkill)) return null;
  return payload.items.map((item) => {
    const row = object(item);
    const id = text(row.id);
    if (!id) return null;
    const ready = kind === 'exam' ? row.status === 'published' && row.exam_only !== true : row.ready === true;
    const already = row.already_given === true;
    let reason = null;
    if (already) reason = 'Đã giao cho lớp này';
    else if (!ready) reason = row.missing_audio ? `Thiếu audio cho ${count(row.missing_audio)} câu` : 'Chưa có nội dung sẵn sàng';
    return {
      id, title: text(row.title) || 'Nội dung chưa đặt tên', code: nullableText(row.code),
      part: finite(row.part), lesson_no: finite(row.lesson_no), ready, already_given: already, reason,
    };
  }).filter(Boolean);
}

export function normalizeQuestions(value) {
  const payload = object(value);
  if (!Array.isArray(payload.items)) return null;
  return {
    questions_per_give: Math.max(1, finite(payload.questions_per_give) || payload.items.length || 1),
    items: payload.items.map((item) => {
      const row = object(item);
      const id = text(row.id);
      return id ? { id, text: text(row.question_text) || 'Câu hỏi chưa có nội dung', ready: row.giveable !== false && row.ready !== false, audio_url: nullableText(row.audio_url) } : null;
    }).filter(Boolean),
  };
}

export function dueParts(value) {
  if (!value) return { date: '', time: '19:00' };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: '', time: '19:00' };
  const options = { timeZone: 'Asia/Ho_Chi_Minh' };
  return {
    date: new Intl.DateTimeFormat('en-CA', { ...options, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date),
    time: new Intl.DateTimeFormat('en-GB', { ...options, hour: '2-digit', minute: '2-digit', hour12: false }).format(date),
  };
}

export function normalizeActionLog(value) {
  const payload = object(value);
  if (!Array.isArray(payload.actions)) return null;
  return {
    actions: payload.actions.map((item) => {
      const row = object(item);
      return {
        id: text(row.id) || `${text(row.created_at)}-${text(row.action)}`,
        action: text(row.action), created_at: nullableText(row.created_at), actor_email: nullableText(row.actor_email),
        assignment_title: nullableText(row.assignment_title), student_name: nullableText(row.student_name), details: object(row.details),
      };
    }),
    has_more: payload.has_more === true,
    next_before: nullableText(payload.next_before),
  };
}
