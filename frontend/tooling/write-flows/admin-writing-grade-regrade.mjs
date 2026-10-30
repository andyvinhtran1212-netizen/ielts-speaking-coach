// Regrade là mutation phá huỷ feedback hiện tại. Luồng này ghim cảnh báo,
// level mặc định và đúng request trên cả Legacy lẫn Next.
const ESSAY = 'essay-admin-regrade';

export default {
  name: 'admin Writing Grade — cảnh báo rồi regrade',
  route: `/admin/writing/grade?id=${ESSAY}`,
  legacyRoute: `/pages/admin/writing/grade.html?id=${ESSAY}`,

  canned: [
    [/\/auth\/me$/, { id: '00000000-0000-0000-0000-000000000000', email: 'admin@local', role: 'admin' }],
    [new RegExp(`/admin/writing/essays/${ESSAY}$`), {
      id: ESSAY,
      status: 'reviewed',
      task_type: 'task2',
      prompt_text: 'Some people think remote work should become the default.',
      essay_text: 'A reviewed essay fixture used to verify destructive regrade UX.',
      created_at: '2026-08-12T00:00:00Z',
      grading_tier: 'standard',
      analysis_level: 3,
      hide_subbands: false,
      student: { student_code: 'S003', full_name: 'Regrade Student' },
      feedback: {
        overall_band_score: 6.5,
        feedback_json: { overallBandScoreSummary: 'Feedback that regrade will replace.' },
      },
    }],
    [new RegExp(`/admin/writing/essays/${ESSAY}/regrade$`), {
      essay_id: ESSAY,
      status: 'grading',
      regrade_count: 1,
      analysis_level: 3,
    }],
  ],

  steps: [
    { wait: 5000 },
    { expectVisible: '#btn-regrade' },
    { click: '#btn-regrade' },
    { expectText: ['.regrade-modal__body', 'Xóa AI feedback hiện tại'] },
    { click: '.regrade-modal__actions .btn-warn' },
    { waitForWrites: [`/admin/writing/essays/${ESSAY}/regrade`, 1] },
  ],

  ignoreWrites: ['/api/analytics/events'],
  writes: [{
    method: 'POST',
    path: `/admin/writing/essays/${ESSAY}/regrade`,
    body: { analysis_level: 3 },
  }],
};
