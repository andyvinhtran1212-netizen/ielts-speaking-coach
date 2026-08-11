// Cùng một bản khai chạy trên Legacy và Next: sửa section trong
// draft → PATCH full feedback để chuyển graded→reviewed → POST deliver.
// Mạng bị chặn; /auth/me fixture có role admin nên flow này phủ
// workspace thật mà G1 denied-state không thể phủ.
const ESSAY = 'essay-admin-1';
const UPDATED = 'Nhận xét tổng quan đã được admin chỉnh sửa.';

export default {
  name: 'admin Writing Grade — lưu duyệt rồi trả bài',
  route: `/admin/writing/grade?id=${ESSAY}`,
  legacyRoute: `/pages/admin/writing/grade.html?id=${ESSAY}`,

  canned: [
    [/\/auth\/me$/, { id: '00000000-0000-0000-0000-000000000000', email: 'admin@local', role: 'admin' }],
    [new RegExp(`/admin/writing/essays/${ESSAY}$`), {
      id: ESSAY,
      status: 'graded',
      task_type: 'task2',
      prompt_text: 'Some people think online learning should replace classrooms.',
      essay_text: 'This is a complete essay used only by the browser write-flow fixture.',
      created_at: '2026-08-12T00:00:00Z',
      grading_tier: 'standard',
      analysis_level: 3,
      hide_subbands: false,
      student: { student_code: 'S001', full_name: 'Flow Student' },
      feedback: {
        overall_band_score: 6.5,
        feedback_json: { overallBandScoreSummary: 'Nhận xét ban đầu.' },
      },
    }],
    [new RegExp(`/admin/writing/essays/${ESSAY}/feedback$`), { essay_id: ESSAY, status: 'reviewed' }],
    [new RegExp(`/admin/writing/essays/${ESSAY}/mark-delivered$`), { essay_id: ESSAY, status: 'delivered', method: 'google_docs_paste', hide_subbands: false }],
  ],

  steps: [
    { wait: 5000 },
    { expectVisible: '#btn-save' },
    { click: '#section-overview .btn-edit' },
    { fill: ['#edit-overview textarea', UPDATED] },
    { click: '#edit-overview .btn-primary' },
    { click: '#btn-save' },
    { waitForWrites: [`/admin/writing/essays/${ESSAY}/feedback`, 1] },
    { click: '#btn-deliver' },
    { waitForWrites: [`/admin/writing/essays/${ESSAY}/mark-delivered`, 1] },
  ],

  ignoreWrites: ['/api/analytics/events'],
  writes: [
    {
      method: 'PATCH',
      path: `/admin/writing/essays/${ESSAY}/feedback`,
      body: { overallBandScoreSummary: UPDATED },
    },
    {
      method: 'POST',
      path: `/admin/writing/essays/${ESSAY}/mark-delivered`,
      body: { method: 'google_docs_paste', hide_subbands: false },
    },
  ],
};
