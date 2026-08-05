// Luồng ghi của `/speaking`: bắt đầu một phiên luyện tập.
//
// Đây là luồng ghi đầu tiên chuyển sang dạng KHAI BÁO. Trước đó nó là một
// script riêng (`verify-speaking-flow.mjs`) — vẫn giữ, vì bản đó còn khẳng định
// những thứ ngoài phạm vi ghi (điều hướng, modal, thông báo lỗi tại chỗ).
// Bản khai này chỉ trả lời ĐÚNG MỘT câu: trang có gửi đúng những gì nó được
// phép gửi, và KHÔNG gửi gì khác.
export default {
  name: 'speaking — bắt đầu luyện theo chủ đề',
  route: '/speaking',

  canned: [
    [/\/auth\/me$/, { __delayMs: 2500, __body: { id: 'u1', display_name: 'Học Viên', permissions: ['all'] } }],
    [/\/topics\?part=/, [{ title: 'Chủ đề mẫu', category: 'Daily life' }]],
    [/\/api\/dashboard\/init$/, { summary: { total_sessions: 0 }, sessions: [] }],
    [/\/sessions\?/, { sessions: [], total: 0, total_pages: 0, page: 1 }],
    [/\/api\/grammar\/dashboard-data$/, {}],
    [/\/api\/mock-exams\/my-sittings$/, { sittings: [] }],
    [/\/api\/flashcards\/due\/count$/, { count: 0 }],
    [/\/sessions$/, { id: 'sess-write-flow-1' }],
  ],

  steps: [
    { click: '.mode-card[data-mode="practice"]' },
    { wait: 300 },
    { click: '#prac-tp-part-2' },
    { wait: 600 },
    { fill: ['#prac-topic-custom', 'Chủ đề kiểm cổng ghi'] },
    { click: '#prac-topic-start' },
  ],

  // Telemetry được tha — nhưng CHỈ telemetry. Mọi đường nghiệp vụ phải khai.
  ignoreWrites: ['/api/analytics/events'],

  writes: [
    {
      method: 'POST',
      path: '/sessions',
      // Ghim CẢ BA: `part` sai nghĩa là học viên luyện nhầm phần thi; `mode`
      // sai nghĩa là phiên bị tính vào loại khác trong sổ tiến bộ.
      body: { mode: 'practice', part: 2, topic: 'Chủ đề kiểm cổng ghi' },
    },
  ],
};
