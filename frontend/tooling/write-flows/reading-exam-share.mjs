// Cùng trang, NHÁNH LIÊN KẾT CHIA SẺ: làm bài không cần tài khoản (`?share=…`).
//
// VÌ SAO PHẢI CÓ: ba bản khai kia đều mở trang bằng `?test_id=` nên chúng chạy
// đúng nhánh CÓ ĐĂNG NHẬP. Nhánh chia sẻ dùng ĐƯỜNG DẪN KHÁC để mở lượt
// (`/share/{token}/attempts`) và — quan trọng hơn — mang danh tính ở TIÊU ĐỀ
// chứ không ở thân request. (bot/codex bắt ở #969)
//
// HỢP ĐỒNG THẬT NẰM Ở TIÊU ĐỀ. `X-Reading-Anon` là giấy tờ DUY NHẤT của một lượt
// làm bài ẩn danh (`reading-exam.js:2980-2997`): máy chủ kiểm nó khi lưu, khi
// nộp và khi xem lại. Mất tiêu đề đó thì thân request vẫn đúng từng chữ mà bài
// không được nhận — đúng kiểu hỏng mà mọi phép so thân đều mù.
//
// Danh tính ấy do CHÍNH máy chủ cấp lúc mở lượt rồi trang cất vào localStorage.
// Nên bản khai này còn ghim cả VÒNG ĐỜI: lúc mở lượt CHƯA có (không được bịa
// ra), từ lần lưu đầu tiên trở đi PHẢI có và phải đúng giá trị máy chủ vừa cấp.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { NO_BODY } from '../write-flow-core.mjs';

const FX = JSON.parse(readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/reading-exam.json'), 'utf8'));

const TOKEN = 'shr-wf-001';
const ANON = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const ATTEMPT = FX.attempt_id;
const STARTED_AT = new Date().toISOString();
const A1 = 'con mèo';
const A2 = 'hai giờ';

export default {
  name: 'reading-exam — làm qua liên kết chia sẻ (ẩn danh)',
  route: '/reading/exam',
  legacyRoute: `/pages/reading-exam.html?share=${TOKEN}`,
  nextPending: 'trang Next chưa tồn tại — bản khai dựng TRƯỚC khi port',
  settleMs: 700,
  drainMs: 2500,

  canned: [
    [/\/api\/reading\/test\/share\/[^/]+\/boot/, { test: FX.test, in_progress: null }],
    // Máy chủ CẤP danh tính ẩn danh ở đây; trang cất nó và dùng cho mọi lời gọi
    // sau. Bỏ `anon_id` khỏi phản hồi là mô phỏng một máy chủ hỏng, không phải
    // trạng thái thật — nên nó có mặt.
    [/\/share\/[^/]+\/attempts$/, {
      attempt_id: ATTEMPT, anon_id: ANON,
      started_at: STARTED_AT, time_limit_minutes: 60,
    }],
    [/\/answers$/, { ok: true }],
    [/\/submit$/, { score: 2, total: 2, correct: 2 }],
  ],

  steps: [
    { wait: 700 },
    { click: '#exam-start-btn' },
    { wait: 700 },
    { expectText: ['.exam-passage__body', 'Nội dung đoạn đọc.'] },
    { fill: ['input[name="q-1"]', A1] },
    { fill: ['input[name="q-2"]', A2] },
    { click: '#exam-passage' },
    { wait: 900 },
    { click: '#exam-submit-btn' },
    { wait: 300 },
    { click: '#exam-submit-confirm' },
    { wait: 400 },
  ],

  ignoreWrites: ['/api/analytics/events'],

  writes: [
    {
      method: 'POST',
      path: `/api/reading/test/share/${TOKEN}/attempts`,
      body: NO_BODY,
      // CHƯA có danh tính lúc này — máy chủ mới là bên cấp. Một bản port tự nghĩ
      // ra id rồi gửi kèm là tự tạo quyền sở hữu, nên ghim là PHẢI VẮNG.
      headers: { 'X-Reading-Anon': (v) => v === undefined },
    },
    {
      method: 'PATCH',
      path: `/api/reading/test/attempts/${ATTEMPT}/answers`,
      times: 2,
      body: (b) => (b.q_num === 1 && b.user_answer === A1)
        || (b.q_num === 2 && b.user_answer === A2),
      bodyAll: (bodies) => new Set(bodies.map((b) => b.q_num)).size === 2,
      headers: { 'X-Reading-Anon': ANON },
    },
    {
      method: 'POST',
      path: `/api/reading/test/attempts/${ATTEMPT}/submit`,
      body: (b) => Array.isArray(b.answers) && b.answers.length === 2,
      headers: { 'X-Reading-Anon': ANON },
    },
  ],
};
