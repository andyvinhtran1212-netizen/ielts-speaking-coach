function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function text(value) {
  return typeof value === 'string' ? value : '';
}

function nullableText(value) {
  const valueText = text(value).trim();
  return valueText || null;
}

function nullableNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeRosterPayload(value, cohortId) {
  const payload = object(value);
  const rawCohort = object(payload.cohort);
  const id = text(rawCohort.id);
  if (!id || (text(cohortId) && id !== text(cohortId)) || !Array.isArray(payload.members)) return null;
  const rawMembers = payload.members;
  const members = rawMembers.map((item) => {
    const row = object(item);
    const studentId = text(row.student_id);
    if (!studentId) return null;
    return {
      student_id: studentId,
      student_code: nullableText(row.student_code),
      name: text(row.name) || 'Học viên chưa đặt tên',
      user_id: nullableText(row.user_id),
      sessions: nullableNumber(row.sessions),
      last_active: nullableText(row.last_active),
      ai_cost_usd: nullableNumber(row.ai_cost_usd),
    };
  }).filter(Boolean);
  return {
    cohort: {
      id,
      name: text(rawCohort.name) || 'Lớp chưa đặt tên',
      code_prefix: nullableText(rawCohort.code_prefix),
      description: nullableText(rawCohort.description),
      course_id: nullableText(rawCohort.course_id),
      is_active: rawCohort.is_active === true,
    },
    member_count: nullableNumber(payload.member_count) ?? rawMembers.length,
    discarded_member_count: rawMembers.length - members.length,
    members,
  };
}

export function normalizeCourseOptions(value) {
  const payload = object(value);
  return (Array.isArray(payload.courses) ? payload.courses : []).map((item) => {
    const row = object(item);
    const id = text(row.id);
    return id ? {
      id,
      code: text(row.code),
      name: text(row.name) || 'Khoá chưa đặt tên',
      is_active: row.is_active !== false,
    } : null;
  }).filter(Boolean);
}

export function selectRoster(members, filters = {}) {
  const query = text(filters.search).trim().toLocaleLowerCase('vi-VN');
  const account = text(filters.account) || 'all';
  return (Array.isArray(members) ? members : []).filter((member) => {
    if (account === 'activated' && !member.user_id) return false;
    if (account === 'unactivated' && member.user_id) return false;
    return !query || `${member.name} ${member.student_code || ''}`.toLocaleLowerCase('vi-VN').includes(query);
  });
}

export function rosterSummary(members) {
  const rows = Array.isArray(members) ? members : [];
  const activated = rows.filter((member) => member.user_id).length;
  return { total: rows.length, activated, unactivated: rows.length - activated };
}

export function normalizeLessonsPayload(value) {
  const payload = object(value);
  return (Array.isArray(payload.lessons) ? payload.lessons : []).map((item) => {
    const row = object(item);
    const id = text(row.id);
    if (!id) return null;
    const attachments = (Array.isArray(row.attachments) ? row.attachments : []).map((itemAttachment) => {
      const attachment = object(itemAttachment);
      const label = text(attachment.label).trim();
      const url = text(attachment.url).trim();
      return label || url ? { label, url, is_safe: Boolean(label && /^https?:\/\//i.test(url)) } : null;
    }).filter(Boolean);
    return {
      id,
      title: text(row.title) || 'Buổi học chưa đặt tên',
      lesson_no: nullableNumber(row.lesson_no),
      lesson_date: nullableText(row.lesson_date),
      body_md: nullableText(row.body_md),
      attachments,
      is_published: Boolean(row.is_published),
      created_at: nullableText(row.created_at),
      updated_at: nullableText(row.updated_at),
    };
  }).filter(Boolean);
}

/** @param {Record<string, any> | null} [lesson] */
export function lessonDraft(lesson = null) {
  return {
    id: lesson?.id || null,
    title: lesson?.title || '',
    lessonNo: lesson?.lesson_no == null ? '' : String(lesson.lesson_no),
    lessonDate: lesson?.lesson_date ? String(lesson.lesson_date).slice(0, 10) : '',
    body: lesson?.body_md || '',
    attachments: Array.isArray(lesson?.attachments) ? lesson.attachments.map((item) => ({ ...item })) : [],
    attachmentsTouched: false,
    isPublished: Boolean(lesson?.is_published),
    error: '',
  };
}

export function validateLessonDraft(draft) {
  const title = text(draft?.title).trim();
  if (!title) return { ok: false, error: 'Nhập tiêu đề buổi học để tiếp tục.' };
  const lessonNoText = text(draft?.lessonNo).trim();
  const lessonNo = lessonNoText ? Number(lessonNoText) : null;
  if (lessonNo != null && (!Number.isInteger(lessonNo) || lessonNo < 1)) {
    return { ok: false, error: 'Số buổi phải là số nguyên từ 1 trở lên.' };
  }
  const attachments = Array.isArray(draft?.attachments) ? draft.attachments : [];
  for (const [index, attachment] of (draft?.attachmentsTouched ? attachments : []).entries()) {
    const label = text(attachment?.label).trim();
    const url = text(attachment?.url).trim();
    if (!label && !url) continue;
    if (!label || !url) return { ok: false, error: `Tài liệu ${index + 1} cần đủ tên và đường dẫn.` };
    if (!/^https?:\/\//i.test(url)) return { ok: false, error: `Tài liệu ${index + 1} dùng liên kết cũ. Hãy đổi sang http:// hoặc https://, hoặc xoá tài liệu này.` };
  }
  const body = {
    title,
    lesson_no: lessonNo,
    lesson_date: nullableText(draft.lessonDate),
    body_md: nullableText(draft.body),
    is_published: Boolean(draft.isPublished),
  };
  if (draft?.attachmentsTouched) {
    body.attachments = attachments.map((attachment) => ({
      label: text(attachment.label).trim(), url: text(attachment.url).trim(),
    })).filter((attachment) => attachment.label && attachment.url);
  }
  return {
    ok: true,
    body,
  };
}

export function normalizeProgressPayload(value) {
  const payload = object(value);
  const degraded = (Array.isArray(payload.degraded) ? payload.degraded : []).filter((item) => typeof item === 'string');
  const students = (Array.isArray(payload.students) ? payload.students : []).map((item) => {
    const row = object(item);
    const id = text(row.student_id);
    if (!id) return null;
    const rawSkills = object(row.skills);
    const skills = {};
    for (const key of ['speaking', 'writing', 'reading', 'listening']) {
      const raw = rawSkills[key];
      if (raw == null) { skills[key] = null; continue; }
      const skill = object(raw);
      skills[key] = {
        attempts: Math.max(0, nullableNumber(skill.attempts) || 0),
        last_activity: nullableText(skill.last_activity),
        last_band: nullableNumber(skill.last_band),
        recent_bands: (Array.isArray(skill.recent_bands) ? skill.recent_bands : []).map(nullableNumber).filter((band) => band != null),
      };
    }
    const rawHomework = row.homework == null ? null : object(row.homework);
    return {
      student_id: id,
      student_code: nullableText(row.student_code),
      name: text(row.name) || 'Học viên chưa đặt tên',
      activated: Boolean(row.activated),
      target_band: nullableNumber(row.target_band),
      skills,
      homework: rawHomework == null ? null : {
        assigned: Math.max(0, nullableNumber(rawHomework.assigned) || 0),
        submitted: Math.max(0, nullableNumber(rawHomework.submitted) || 0),
        late: Math.max(0, nullableNumber(rawHomework.late) || 0),
        missing: Math.max(0, nullableNumber(rawHomework.missing) || 0),
        on_time_pct: nullableNumber(rawHomework.on_time_pct),
      },
    };
  }).filter(Boolean);
  return { students, degraded };
}

export function latestSkillActivity(skills) {
  const stamps = Object.values(object(skills)).map((skill) => object(skill).last_activity).filter(Boolean);
  const parsed = stamps.map((stamp) => ({ stamp, time: Date.parse(stamp) })).filter((item) => Number.isFinite(item.time));
  return parsed.sort((left, right) => right.time - left.time)[0]?.stamp || null;
}

export function normalizeStudentOptions(value) {
  if (!Array.isArray(value)) return null;
  return value.map((item) => {
    const row = object(item);
    const id = text(row.id);
    return id ? {
      id,
      student_code: text(row.student_code) || 'Chưa có mã',
      full_name: text(row.full_name) || 'Học viên chưa đặt tên',
      cohort_id: nullableText(row.cohort_id),
      cohort_name: nullableText(row.cohort_name),
    } : null;
  }).filter(Boolean);
}
