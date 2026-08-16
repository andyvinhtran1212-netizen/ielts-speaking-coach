// Cùng một bản khai chạy trên Legacy và Next: bài đã giao phải có thể được
// thu hồi qua endpoint canonical, giữ nguyên feedback và quay về reviewed.
const ESSAY = 'essay-admin-revoke';

export default {
  name: 'admin Writing Grade — thu hồi bài đã giao',
  route: `/admin/writing/grade?id=${ESSAY}`,
  legacyRoute: `/pages/admin/writing/grade.html?id=${ESSAY}`,

  canned: [
    [/\/auth\/me$/, { id: '00000000-0000-0000-0000-000000000000', email: 'admin@local', role: 'admin' }],
    [new RegExp(`/admin/writing/essays/${ESSAY}$`), {
      id: ESSAY,
      status: 'delivered',
      task_type: 'task2',
      prompt_text: 'Discuss whether cities should invest more in public transport.',
      essay_text: 'A delivered essay fixture used to verify the revoke transition.',
      created_at: '2026-08-12T00:00:00Z',
      grading_tier: 'standard',
      analysis_level: 3,
      hide_subbands: false,
      student: { student_code: 'S002', full_name: 'Revoke Student' },
      feedback: {
        overall_band_score: 7,
        feedback_json: { overallBandScoreSummary: 'Feedback must survive revoke.' },
      },
    }],
    [new RegExp(`/admin/writing/essays/${ESSAY}/revoke-delivery$`), {
      essay_id: ESSAY,
      status: 'reviewed',
    }],
  ],

  steps: [
    { wait: 5000 },
    { expectVisible: '#btn-revoke' },
    { click: '#btn-revoke' },
    { waitForWrites: [`/admin/writing/essays/${ESSAY}/revoke-delivery`, 1] },
    { expectVisible: '.av-toast' },
    { expectText: ['.av-toast', 'Đã thu hồi bài'] },
  ],

  ignoreWrites: ['/api/analytics/events'],
  writes: [{
    method: 'POST',
    path: `/admin/writing/essays/${ESSAY}/revoke-delivery`,
    body: (body) => Boolean(body) && Object.keys(body).length === 0,
  }],
};
