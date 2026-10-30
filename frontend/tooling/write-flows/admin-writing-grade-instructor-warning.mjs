// Tier Instructor không có review row là trạng thái dữ liệu không nhất quán.
// Cảnh báo phải hiện; mutation rating làm đối chứng dương để flow không thể
// xanh chỉ vì trang không chạy tới behavior.
const ESSAY = 'essay-admin-instructor-missing';

export default {
  name: 'admin Writing Grade — cảnh báo thiếu instructor review',
  route: `/admin/writing/grade?id=${ESSAY}`,
  legacyRoute: `/pages/admin/writing/grade.html?id=${ESSAY}`,

  canned: [
    [/\/auth\/me$/, { id: '00000000-0000-0000-0000-000000000000', email: 'admin@local', role: 'admin' }],
    [new RegExp(`/admin/writing/essays/${ESSAY}$`), {
      id: ESSAY,
      status: 'graded',
      task_type: 'task2',
      prompt_text: 'Discuss whether schools should teach financial literacy.',
      essay_text: 'An instructor-tier essay fixture with a deliberately missing review row.',
      created_at: '2026-08-12T00:00:00Z',
      grading_tier: 'instructor',
      analysis_level: 4,
      hide_subbands: false,
      selected_model: 'fixture-grader',
      student: { student_code: 'S004', full_name: 'Instructor Student' },
      feedback: {
        overall_band_score: 7,
        feedback_json: { overallBandScoreSummary: 'Instructor review row is missing.' },
      },
    }],
    [new RegExp(`/admin/instructor/queue\\?.*essay_id=${ESSAY}`), []],
    [new RegExp(`/admin/writing/essays/${ESSAY}/grade-rating$`), {
      essay_id: ESSAY,
      rating: 1,
      note: '',
      grading_model: 'fixture-grader',
    }],
  ],

  steps: [
    { expectVisible: '#gr-save' },
    { expectVisible: '#instructor-context-warning, .av-toast' },
    { expectText: ['#instructor-context-warning, .av-toast', 'chưa có review row'] },
    { click: '#gr-stars .gr-star' },
    { click: '#gr-save' },
    { waitForWrites: [`/admin/writing/essays/${ESSAY}/grade-rating`, 1] },
  ],

  ignoreWrites: ['/api/analytics/events'],
  writes: [{
    method: 'POST',
    path: `/admin/writing/essays/${ESSAY}/grade-rating`,
    body: { rating: 1, note: '' },
  }],
};
