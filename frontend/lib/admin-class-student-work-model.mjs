const object = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const text = (value) => typeof value === 'string' ? value : '';
const nullableText = (value) => text(value).trim() || null;
const finite = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;

const SKILLS = new Set(['speaking', 'reading', 'listening', 'course']);

export function normalizeStudentWork(value, expectedStudentId) {
  const payload = object(value);
  const student = object(payload.student);
  if (!text(student.id) || student.id !== expectedStudentId || !Array.isArray(payload.items)) return null;
  const items = payload.items.map((value) => {
    const row = object(value);
    const skill = text(row.skill);
    if (!text(row.assignment_id) || !SKILLS.has(skill)) return null;
    return {
      assignment_id: row.assignment_id,
      title: text(row.title) || 'Bài tập chưa đặt tên',
      skill,
      due_at: nullableText(row.due_at),
      created_at: nullableText(row.created_at),
      archived: row.archived === true,
      status: text(row.status) || 'pending',
      submitted_at: nullableText(row.submitted_at),
      score: finite(row.score),
      artifact_kind: nullableText(row.artifact_kind),
      artifact_id: nullableText(row.artifact_id),
      has_writing: row.has_writing === true,
      bank_id: nullableText(row.bank_id),
    };
  }).filter(Boolean);
  return {
    student: {
      id: student.id,
      name: text(student.name),
      student_code: nullableText(student.student_code),
      activated: student.activated === true,
    },
    items,
    discarded_item_count: payload.items.length - items.length,
    homework_stale: payload.homework_stale === true,
  };
}

export function studentWorkAction(item) {
  if (item?.artifact_kind === 'session' && item.artifact_id) {
    return { kind: 'external', label: 'Nghe bài', href: `/admin/speaking/sessions?session=${encodeURIComponent(item.artifact_id)}` };
  }
  if (item?.has_writing) return { kind: 'writing', label: 'Xem tự luận' };
  if (item?.bank_id && item.artifact_id) return { kind: 'report', label: 'Xem từng câu' };
  return null;
}
