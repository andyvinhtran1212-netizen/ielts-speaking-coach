// WRITINGBAND-0050: a successful write followed by a failed canonical read
// must not advance the queue or permit delivery on stale feedback.
import { AAL2_STATUS } from '../admin-mfa-stub.mjs';

const ESSAY = 'essay-admin-refresh-fail';
const NEXT = 'essay-admin-next-must-not-open';
const UPDATED = 'Draft đã lưu nhưng chưa đọc lại được.';
const ACCOUNT = '00000000-0000-0000-0000-000000000000';

let saved = false;

export default {
  name: 'admin Writing Grade — save-next dừng lại khi tải lại kết quả lỗi',
  bypassCSP: true,
  route: `/admin/writing/grade?essay_id=${ESSAY}&from=queue`,
  expectFinalUrl: new RegExp(`/(?:admin/writing/grade|pages/admin/writing/grade\\.html)\\?(?:id|essay_id)=${ESSAY}(?:&from=queue)?$`),
  initSessionStorage: {
    gradeQueue: JSON.stringify({ accountId: ACCOUNT, contextKey: '', ids: [ESSAY, NEXT], i: 0 }),
  },

  canned: [
    [/\/auth\/me$/, { id: '00000000-0000-0000-0000-000000000000', email: 'admin@local', role: 'admin' }],
    // ADMINAAL2-0032 T010: AdminAccessGate fails closed on the `{}` catch-all.
    [/\/admin\/mfa\/status$/, AAL2_STATUS],
    [new RegExp(`/admin/writing/essays/${ESSAY}$`), () => saved ? { __status: 500, __body: { detail: 'simulated canonical refresh failure' } } : ({
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
    })],
    [new RegExp(`/admin/writing/essays/${ESSAY}/feedback$`), () => { saved = true; return { essay_id: ESSAY, status: 'reviewed' }; }],
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
    { expectText: ['#alert-area', 'Đã lưu, nhưng chưa tải lại được kết quả'] },
    { expectVisible: '#btn-save-next:disabled' },
    { expectVisible: '#btn-deliver:disabled' },
  ],

  ignoreWrites: ['/api/analytics/events'],
  writes: [{
    method: 'PATCH',
    path: `/admin/writing/essays/${ESSAY}/feedback`,
    body: { overallBandScoreSummary: UPDATED },
  }],
};
