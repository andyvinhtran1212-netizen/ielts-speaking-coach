export const WRITING_TASK_LABELS = Object.freeze({
  task1_academic: 'Task 1 (Academic)',
  task1_general: 'Task 1 (General)',
  task2: 'Task 2',
});

export function formatWritingDate(value) {
  if (!value) return '';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

export function countWritingWords(value) {
  const text = String(value || '').trim();
  return text ? text.split(/\s+/).length : 0;
}

export function classifyWritingResult(payload) {
  const data = payload && typeof payload === 'object' ? payload : {};
  const essay = data.essay || data;
  const feedback = data.feedback || null;

  if (essay?.is_flagged) return { kind: 'flagged', essay, feedback: null };
  if (essay?.status !== 'delivered' || !feedback) {
    return { kind: 'not-delivered', essay, feedback: null };
  }
  return {
    kind: 'ready',
    essay,
    feedback,
    instructorNote: data.instructor_note || '',
    feedbackJson: feedback.feedback_json || {},
  };
}

export function writingBandLabel(feedback, feedbackJson) {
  const value = feedback?.overall_band_score ?? feedbackJson?.overallBandScore;
  return value == null ? 'Band —' : `Band ${value}`;
}

export function essayTaskToTipTask(taskType) {
  if (taskType === 'task2') return 'task_2';
  if (taskType === 'task1_academic' || taskType === 'task1_general') return 'task_1';
  return null;
}

export function selectWritingTips(tips, taskType, limit = 3) {
  const wanted = essayTaskToTipTask(taskType);
  return (Array.isArray(tips) ? tips : [])
    .filter((tip) => tip?.task_type === wanted || tip?.task_type === 'both')
    .slice(0, limit);
}

export function writingTipPreview(markdown, limit = 110) {
  const text = String(markdown || '')
    .replace(/[#>*_`~\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > limit ? `${text.slice(0, limit).trim()}…` : text;
}

export function regradeStatusText(request) {
  if (!request) return '';
  if (request.status === 'pending') {
    return '⏳ Đã gửi yêu cầu chấm lại — chờ giảng viên phản hồi.';
  }
  if (request.status === 'rejected') {
    return `Yêu cầu chấm lại bị từ chối: ${request.admin_response || '—'}`;
  }
  if (request.status === 'fulfilled') {
    return '✓ Bài đã được chấm lại theo yêu cầu của em.';
  }
  return '';
}

export function selectWritingResultView(resultState, requestKey) {
  if (resultState?.key === requestKey && resultState.value) return resultState.value;
  return { kind: 'loading' };
}
