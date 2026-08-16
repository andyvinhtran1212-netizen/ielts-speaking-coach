// Queue navigation chỉ được xảy ra SAU KHI feedback đã persist. Request 500
// dưới đây phải để admin ở nguyên essay hiện tại trên cả Legacy và Next.
const ESSAY = 'essay-admin-save-fail';
const NEXT = 'essay-admin-next-must-not-open';
const UPDATED = 'Draft này không được phép bị bỏ lại khi server từ chối lưu.';

export default {
  name: 'admin Writing Grade — save-next dừng lại khi lưu lỗi',
  route: `/admin/writing/grade?id=${ESSAY}`,
  legacyRoute: `/pages/admin/writing/grade.html?id=${ESSAY}`,
  expectFinalUrl: new RegExp(`/(?:admin/writing/grade|pages/admin/writing/grade\\.html)\\?(?:id|essay_id)=${ESSAY}$`),
  initSessionStorage: {
    gradeQueue: JSON.stringify({ ids: [ESSAY, NEXT], i: 0 }),
  },

  canned: [
    [/\/auth\/me$/, { id: '00000000-0000-0000-0000-000000000000', email: 'admin@local', role: 'admin' }],
    [new RegExp(`/admin/writing/essays/${ESSAY}$`), {
      id: ESSAY,
      status: 'graded',
      task_type: 'task2',
      prompt_text: 'Discuss whether university education should be free.',
      essay_text: 'A queue fixture used to verify save failure cannot advance navigation.',
      created_at: '2026-08-12T00:00:00Z',
      grading_tier: 'standard',
      analysis_level: 3,
      hide_subbands: false,
      student: { student_code: 'S005', full_name: 'Save Failure Student' },
      feedback: {
        overall_band_score: 6,
        feedback_json: { overallBandScoreSummary: 'Original summary.' },
      },
    }],
    [new RegExp(`/admin/writing/essays/${ESSAY}/feedback$`), {
      __status: 500,
      __body: { detail: 'simulated persistence failure' },
    }],
  ],

  steps: [
    { wait: 5000 },
    { expectVisible: '#btn-save-next' },
    { click: '#section-overview .btn-edit' },
    { fill: ['#edit-overview textarea', UPDATED] },
    { click: '#edit-overview .btn-primary' },
    { click: '#btn-save-next' },
    { waitForWrites: [`/admin/writing/essays/${ESSAY}/feedback`, 1] },
    { expectVisible: '.av-toast' },
    { expectText: ['.av-toast', 'Save failed'] },
  ],

  ignoreWrites: ['/api/analytics/events'],
  writes: [{
    method: 'PATCH',
    path: `/admin/writing/essays/${ESSAY}/feedback`,
    body: { overallBandScoreSummary: UPDATED },
  }],
};
