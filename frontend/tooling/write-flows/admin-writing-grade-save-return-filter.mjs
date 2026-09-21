// Native Mock Writing must preserve the complete operational scope after the
// operator opens an essay, saves it, and explicitly returns to the queue.
const ESSAY = 'essay-admin-filter-return';
const UPDATED = 'Bản sửa dùng để xác minh quay lại đúng phạm vi Failed.';

export default {
  name: 'admin Writing Grade — save-return giữ phạm vi Mock Failed/lớp/quá hạn',
  route: `/admin/writing/grade?essay_id=${ESSAY}&embed=1&mocklane=1&queue_status=failed&cohort_id=c1&overdue=1`,
  expectFinalUrl: '/admin/writing/queue?embed=1&mocklane=1&queue_status=failed&cohort_id=c1&overdue=1',
  initSessionStorage: {
    gradeQueue: JSON.stringify({ ids: [ESSAY], i: 0 }),
  },

  canned: [
    [/\/auth\/me$/, { id: '00000000-0000-0000-0000-000000000000', email: 'admin@local', role: 'admin' }],
    [new RegExp(`/admin/writing/essays/${ESSAY}$`), {
      id: ESSAY,
      status: 'graded',
      task_type: 'task2',
      prompt_text: 'Discuss a public policy question.',
      essay_text: 'A fixture that verifies the Mock queue filter survives save-and-return.',
      created_at: '2026-08-12T00:00:00Z',
      grading_tier: 'standard',
      analysis_level: 3,
      hide_subbands: false,
      student: { student_code: 'S006', full_name: 'Filter Return Student' },
      feedback: {
        overall_band_score: 6,
        feedback_json: { overallBandScoreSummary: 'Original summary.' },
      },
    }],
    [new RegExp(`/admin/writing/essays/${ESSAY}/feedback$`), { essay_id: ESSAY, status: 'reviewed' }],
  ],

  steps: [
    { wait: 5000 },
    { expectVisible: '#btn-save-next' },
    { click: '#section-overview .btn-edit' },
    { fill: ['#edit-overview textarea', UPDATED] },
    { click: '#edit-overview .btn-primary' },
    { click: '#btn-save-next' },
    { waitForWrites: [`/admin/writing/essays/${ESSAY}/feedback`, 1] },
  ],

  ignoreWrites: ['/api/analytics/events'],
  writes: [{
    method: 'PATCH',
    path: `/admin/writing/essays/${ESSAY}/feedback`,
    body: { overallBandScoreSummary: UPDATED },
  }],
};
