// Luồng ghi của bài thi Đọc: bắt đầu → gõ đáp án (tự lưu) → nộp.
//
// VÌ SAO TRANG NÀY TRƯỚC trong nhóm Reading: nó là trang có-ghi duy nhất đã gây
// SỰ CỐ THẬT. Chú thích ngay trong `reading-exam.js:1650` ghi lại: "một học viên
// làm hết hai section mà bị chấm 0 trong khi mọi bảng điều khiển đều xanh
// (26/07/2026)" — đường tự lưu im lặng không tới máy chủ. Không phép so DOM nào
// thấy được chuyện đó; đúng hình dạng cổng này sinh ra để chặn.
//
// BA ĐƯỜNG GHI, không phải một:
//   1. POST .../attempts          — mở lượt làm bài
//   2. PATCH .../answers          — TỰ LƯU từng câu, debounce 500ms
//   3. POST .../submit            — nộp cả bài
// Bản khai ghim CẢ BA theo đúng thứ tự, vì mất bất kỳ khâu nào cũng là mất bài
// của học viên mà màn hình vẫn xanh.
import { NO_BODY } from '../write-flow-core.mjs';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FX = JSON.parse(readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/reading-exam.json'), 'utf8'));

const TEST = FX.test_id;
const ATTEMPT = FX.attempt_id;
// Mốc bắt đầu phải là BÂY GIỜ, không phải hằng số trong tệp JSON. Trang tính
// thời gian còn lại từ `started_at + time_limit_minutes`; một mốc cố định sẽ hết
// hạn ngay khi đồng hồ đi qua, và trang TỰ NỘP rồi nhảy thẳng sang màn kết quả —
// bản khai đỏ ở khâu tự lưu với thông báo "0 lần" trông y hệt một lỗi tự lưu
// thật. Đây là chỗ dữ liệu giả PHẢI động, khác với `content_id`/`payload` vốn
// phải tĩnh để bộ kiểm backend soi được.
const STARTED_AT = new Date().toISOString();
const A1 = 'con mèo';
const A2 = 'hai giờ';

export default {
  name: 'reading-exam — bắt đầu, tự lưu, nộp',
  route: '/reading/exam',
  legacyRoute: `/pages/reading-exam.html?test_id=${TEST}`,
  nextPending: 'trang Next chưa tồn tại — bản khai dựng TRƯỚC khi port',
  settleMs: 700,
  drainMs: 2500,

  canned: [
    [/\/api\/reading\/test\/[^/]+\/boot/, { test: FX.test, in_progress: null }],
    [/\/attempts$/, {
      attempt_id: ATTEMPT,
      started_at: STARTED_AT,
      time_limit_minutes: 60,
    }],
    [/\/answers$/, { ok: true }],
    [/\/submit$/, { score: 2, total: 2, correct: 2 }],
  ],

  steps: [
    { wait: 700 },
    { click: '#exam-start-btn' },
    { wait: 700 },
    // Đoạn đọc phải HIỆN CHỮ. Không có dòng này thì một fixture sai tên trường
    // vẫn cho luồng xanh, vì luồng chỉ cần ô nhập tồn tại.
    { expectText: ['.exam-passage__body', 'Nội dung đoạn đọc.'] },
    { fill: ['input[name="q-1"]', A1] },
    { fill: ['input[name="q-2"]', A2] },
    // Rời tiêu điểm TRƯỚC khi chờ. Bấm thẳng nút Nộp trong khi ô cuối còn tiêu
    // điểm sẽ sinh thêm một `change` → tự lưu lại đúng giá trị cũ → 3 lần ghi
    // thay vì 2. Đó là hành vi THẬT, nhưng là chi tiết ngẫu nhiên; ghim nó ở đây
    // sẽ làm bản khai đỏ với một bản port hợp lệ mà chỉ khác chỗ đặt `blur`.
    // Nhánh không-rời-tiêu-điểm được ghim riêng ở `reading-exam-save-on-submit`,
    // nơi nó là ĐIỀU CẦN KIỂM chứ không phải nhiễu.
    { click: '#exam-passage' },
    // Tự lưu debounce 500ms — chờ qua ngưỡng đó rồi mới nộp, để bản khai kiểm
    // ĐƯỢC khâu tự lưu chứ không chỉ khâu nộp.
    { wait: 900 },
    // Nút Nộp chỉ MỞ HỘP XÁC NHẬN; đường ghi nằm sau nút trong hộp. Bấm nhầm
    // nút ngoài rồi kết luận "trang không nộp" là đọc sai một bước hỏi lại có
    // chủ ý.
    { click: '#exam-submit-btn' },
    { wait: 300 },
    { click: '#exam-submit-confirm' },
    { wait: 400 },
  ],

  ignoreWrites: ['/api/analytics/events'],

  writes: [
    // Mở lượt làm bài KHÔNG mang thân (`reading-exam.js:2890` truyền `null`).
    // Bỏ trống `body` nghĩa là "không soi", nên một bản port gửi kèm thân tuỳ ý
    // vẫn qua — `NO_BODY` mới là điều muốn nói (codex cục bộ #969).
    { method: 'POST', path: `/api/reading/test/${TEST}/attempts`, body: NO_BODY },
    {
      method: 'PATCH',
      path: `/api/reading/test/attempts/${ATTEMPT}/answers`,
      times: 2,
      // TƯƠNG QUAN, không phải hai điều kiện rời. Khai từng trường riêng thì một
      // cặp bị hoán đổi — `{q_num:1, user_answer:'hai giờ'}` — vẫn qua, tức đáp
      // án của học viên vào nhầm câu mà cổng không thấy (codex cục bộ #969).
      body: (b) => (b.q_num === 1 && b.user_answer === A1)
        || (b.q_num === 2 && b.user_answer === A2),
      // `body` được gọi RIÊNG cho từng request, nên vị từ trên vẫn qua khi trang
      // gửi HAI LẦN CÙNG một câu — câu còn lại không được lưu, đúng thứ bản khai
      // tưởng mình đang chặn. Chỉ nhìn cả tập mới thấy thiếu (bot bắt ở #969).
      bodyAll: (bodies) => bodies.length === 2
        && new Set(bodies.map((b) => b.q_num)).size === 2,
    },
    {
      method: 'POST',
      path: `/api/reading/test/attempts/${ATTEMPT}/submit`,
      body: {
        answers: (v) => Array.isArray(v) && v.length === 2
          && v.some((a) => a.q_num === 1 && a.user_answer === A1)
          && v.some((a) => a.q_num === 2 && a.user_answer === A2),
      },
    },
  ],
};
