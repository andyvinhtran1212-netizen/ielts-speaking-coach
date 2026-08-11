// Hợp đồng ghi của trang kết quả Writing: học viên chỉ được gửi đúng một yêu
// cầu chấm lại, với lý do đã trim và dài 50–500 ký tự. Cùng bản khai chạy trên
// legacy và Next để việc port không làm đổi endpoint/thân request.
const ESSAY_ID = 'essay-result-1';
const REASON = 'Em nghĩ phần Task Response cần được xem lại vì dẫn chứng của em chưa được ghi nhận đầy đủ.';

export default {
  name: 'writing result — gửi yêu cầu chấm lại',
  route: `/writing/result?id=${ESSAY_ID}`,
  legacyRoute: `/pages/writing-result.html?id=${ESSAY_ID}`,

  canned: [
    [/\/api\/writing\/my-essays\/essay-result-1$/, {
      essay: {
        id: ESSAY_ID,
        status: 'delivered',
        task_type: 'task2',
        prompt_text: 'Some people believe tests are useful. Discuss both views.',
        essay_text: 'This is a complete student essay for the write-flow fixture.',
        created_at: '2026-08-12T00:00:00Z',
        grading_tier: 'standard',
        hide_subbands: false,
      },
      feedback: { overall_band_score: 7, feedback_json: {} },
      instructor_note: '',
    }],
    [/\/api\/writing\/essays\/essay-result-1\/regrade-request$/, { request: null }],
    [/\/api\/writing\/tips$/, { tips: [] }],
  ],

  steps: [
    // Trang chờ chuỗi CDN Supabase → api.js → shared renderers. `expectVisible`
    // vẫn có timeout riêng; khoảng đệm này tránh biến tốc độ tải CDN thành lỗi
    // hành vi trong khi mutation phía dưới vẫn được đồng bộ theo request thật.
    { wait: 5000 },
    { expectVisible: '#btn-regrade-request' },
    { click: '#btn-regrade-request' },
    { fill: ['#regrade-reason', REASON] },
    { click: '#regrade-submit' },
    { waitForWrites: [`/api/writing/essays/${ESSAY_ID}/regrade-request`, 1] },
  ],

  ignoreWrites: ['/api/analytics/events'],
  writes: [{
    method: 'POST',
    path: `/api/writing/essays/${ESSAY_ID}/regrade-request`,
    body: { reason: REASON },
  }],
};
