// Một claim có thể hết hiệu lực giữa lúc tải trang và lúc deliver. HTTP 403
// phải hiện thành lỗi rõ ràng, không được trở thành unhandled rejection hoặc
// khiến admin tưởng học viên đã nhận bài.
const ESSAY = 'essay-admin-instructor-fail';
const REVIEW = '00000000-0000-0000-0000-000000000403';
const ADMIN = '00000000-0000-0000-0000-000000000000';

export default {
  name: 'admin Writing Grade — instructor deliver 403 hiện lỗi',
  route: `/admin/writing/grade?id=${ESSAY}`,
  legacyRoute: `/pages/admin/writing/grade.html?id=${ESSAY}`,

  canned: [
    [/\/auth\/me$/, { id: ADMIN, email: 'admin@local', role: 'admin' }],
    [new RegExp(`/admin/writing/essays/${ESSAY}$`), {
      id: ESSAY,
      status: 'reviewed',
      task_type: 'task2',
      prompt_text: 'Discuss whether public libraries remain important.',
      essay_text: 'An instructor fixture whose claim expires before delivery.',
      created_at: '2026-08-12T00:00:00Z',
      grading_tier: 'instructor',
      analysis_level: 4,
      hide_subbands: false,
      student: { student_code: 'S006', full_name: 'Instructor Failure Student' },
      feedback: {
        overall_band_score: 7,
        feedback_json: { overallBandScoreSummary: 'Reviewed feedback fixture.' },
      },
    }],
    [new RegExp(`/admin/instructor/queue\\?.*essay_id=${ESSAY}`), [{
      review: {
        id: REVIEW,
        status: 'claimed',
        claimed_by: ADMIN,
        claimed_at: '2026-08-12T00:00:00Z',
        instructor_note: null,
      },
      essay_id: ESSAY,
      student_level: 4,
      task_type: 'task2',
      submitted_at: '2026-08-12T00:00:00Z',
      age_hours: 1,
      is_overdue: false,
    }]],
    [new RegExp(`/admin/instructor/reviews/${REVIEW}/deliver$`), {
      __status: 403,
      __body: { detail: 'claim is no longer owned by this admin' },
    }],
  ],

  steps: [
    { expectVisible: '#instructor-panel .instructor-panel-actions .btn-primary' },
    { click: '#instructor-panel .instructor-panel-actions .btn-primary' },
    { waitForWrites: [`/admin/instructor/reviews/${REVIEW}/deliver`, 1] },
    { expectVisible: '.av-toast' },
    { expectText: ['.av-toast', 'Lỗi deliver'] },
  ],

  ignoreWrites: ['/api/analytics/events'],
  writes: [{
    method: 'POST',
    path: `/admin/instructor/reviews/${REVIEW}/deliver`,
    body: { instructor_note: null },
  }],
};
