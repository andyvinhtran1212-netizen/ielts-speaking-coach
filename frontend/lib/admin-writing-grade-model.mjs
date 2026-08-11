export const ADMIN_GRADE_SECTIONS = [
  { key: 'criteria', tab: 'tongquan', title: '🎯 4 tiêu chí IELTS', rows: 14 },
  { key: 'overview', tab: 'tongquan', title: '📊 Tổng quan', rows: 5, string: true },
  { key: 'trajectory', tab: 'tongquan', title: '📈 Diễn biến band', rows: 10 },
  { key: 'mistakes', tab: 'loi', title: '❌ Lỗi sai', rows: 16 },
  { key: 'recurring', tab: 'loi', title: '🔁 Lỗi lặp lại', rows: 10 },
  { key: 'lexical', tab: 'nangcao', title: '📚 Lexical', rows: 12 },
  { key: 'sentence-structure', tab: 'nangcao', title: '🏗 Cấu trúc câu', rows: 12 },
  { key: 'coherence', tab: 'nangcao', title: '🧩 Coherence', rows: 12 },
  { key: 'idea-development', tab: 'nangcao', title: '💡 Idea Development', rows: 12 },
  { key: 'counterargument', tab: 'nangcao', title: '⚖ Counterargument', rows: 10 },
  { key: 'improved', tab: 'baimau', title: '✨ Bài cải thiện', rows: 20, string: true },
  { key: 'ai-content', tab: 'baimau', title: '🤖 AI check', rows: 6 },
  { key: 'key-takeaways', tab: 'baimau', title: '🎓 Key takeaways', rows: 8 },
];

export const ADMIN_GRADE_TABS = [
  { key: 'tongquan', icon: '📊', label: 'Tổng quan' },
  { key: 'loi', icon: '❌', label: 'Nhận xét lỗi' },
  { key: 'nangcao', icon: '🔬', label: 'Phân tích nâng cao' },
  { key: 'baimau', icon: '📚', label: 'Bài mẫu tham khảo' },
];

export const REGRADE_LEVELS = [
  { value: 1, label: 'L1 — Ngữ pháp cơ bản (~B4–5.5)' },
  { value: 2, label: 'L2 — Liên kết / mạch lạc (~B5.5–6.5)' },
  { value: 3, label: 'L3 — Ý tưởng / lập luận (~B6.5–7.5)' },
  { value: 4, label: 'L4 — Từ vựng / cấu trúc câu (~B7.5–8.5)' },
  { value: 5, label: 'L5 — Khắt khe, tinh tế (~B9)' },
];

export function selectKeyedAdminState(state, requestKey) {
  return requestKey && state?.key === requestKey
    ? state.value
    : { phase: 'loading' };
}

export function parseAdminGradeDraft(raw, stringSection = false) {
  if (stringSection) return { ok: true, value: raw };
  if (!String(raw).trim()) return { ok: true, value: null };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (error) {
    return { ok: false, error: `JSON không hợp lệ: ${error.message}` };
  }
}

export function adminGradeActionState(status) {
  return {
    canSave: status === 'graded' || status === 'reviewed',
    canDeliver: status === 'reviewed',
    canRevoke: status === 'delivered',
  };
}

export function adminGradeTaskLabel(taskType) {
  return ({
    task1_academic: 'Task 1 (Academic)',
    task1_general: 'Task 1 (General)',
    task2: 'Task 2',
  })[taskType] || taskType || 'Task —';
}

export function adminGradeRequestKey(accountId, essayId) {
  return accountId ? `${accountId}:${essayId || '__missing__'}` : '';
}

export function readAdminGradeQueue(storageValue, essayId) {
  if (!storageValue) return null;
  try {
    const queue = JSON.parse(storageValue);
    if (!queue || !Array.isArray(queue.ids) || !queue.ids.length) return null;
    const index = queue.ids.indexOf(essayId);
    if (index < 0) return null;
    return {
      nextId: index + 1 < queue.ids.length ? queue.ids[index + 1] : null,
      inQueue: true,
    };
  } catch {
    return null;
  }
}

export function classifyInstructorReview(review, adminId) {
  if (!review) return { kind: 'missing' };
  if (review.status === 'delivered') return { kind: 'delivered', review };
  if (review.status === 'claimed' && review.claimed_by === adminId) {
    return { kind: 'mine', review };
  }
  if (review.status === 'claimed') return { kind: 'locked', review };
  return { kind: 'queued', review };
}
