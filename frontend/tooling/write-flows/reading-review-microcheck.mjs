// Trang CHỮA BÀI Đọc: học viên trả lời một câu hỏi-nhỏ (micro-check) trong lời
// giải, và kết quả được ghi vào bản đồ THÀNH THẠO của em.
//
// VÌ SAO ĐÁNG GHIM: đây là đường ghi duy nhất trong sản phẩm mà học viên KHÔNG
// nhìn thấy hậu quả. Nộp bài sai thì em thấy điểm; ở đây `correct` ghi ngược là
// hồ sơ thành thạo lệch đi âm thầm, rồi hệ thống gợi ý sai bài cho những tuần
// sau. Không màn hình nào tố cáo chuyện đó.
//
// BA ĐIỀU ĐƯỢC GHIM, mỗi cái một kiểu hỏng riêng:
//   · `correct` phải theo ĐÚNG nút vừa bấm — ghi ngược là làm hỏng dữ liệu học
//     tập theo chiều không ai lần ra được;
//   · `kp` phải là ĐỐI TƯỢNG `{type, slug, anchor}` — backend đọc từng trường
//     (`routers/kp.py:54-56`); gửi chuỗi thì mọi câu trả lời bị BỎ QUA lặng lẽ
//     (endpoint "skips, does not error");
//   · ĐÚNG MỘT lần ghi cho mỗi micro-check — trang chốt bằng `mc.dataset.done`.
//     Mất chốt đó là mỗi cú bấm lại thêm một bằng chứng, và em bấm nghịch vài
//     lần là bản đồ thành thạo lệch hẳn.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Dữ liệu giả đọc từ tệp JSON dùng chung, và
// `backend/tests/test_write_flow_fixtures.py` bắt nó qua CHÍNH hàm production:
// `validate_solution_structure`, `resolve_ref` (KP phải giải được), và
// `build_stepper(solution)` phải BẰNG ĐÚNG `stepper` trong fixture.
//
// Bản đầu tôi viết thẳng vào đây và sai hai chỗ mà không gì bắt được: hành động
// `scan` không có trong danh sách đóng, và KP `thi-hien-tai-don` không có bài
// nào — production sẽ BỎ QUA lặng lẽ (`recorded: 0`) trong khi bản khai vẫn
// xanh. (codex cục bộ #985)
const FX = JSON.parse(readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/reading-review.json'), 'utf8'));

const ATTEMPT = FX.attempt_id;
const KP = FX.kp;

// `passages` + `passage_order` là BẮT BUỘC: trang gom câu theo phần
// (`reading-review.js:149-152`) rồi `sort` — thiếu là `undefined.sort` và cả
// trang vào màn lỗi. Bỏ sót vì tôi chỉ nhìn phần render micro-check.
const REVIEW = {
  attempt_id: ATTEMPT,
  status: 'submitted',
  test_id: 'RD-WRITE-FLOW-1',
  title: 'Reading review write-flow fixture',
  score: 0,
  max_score: 1,
  band_estimate: 3,
  passages: [{ passage_order: 1, title: 'Đoạn 1', body_markdown: 'Nội dung đoạn đọc.' }],
  skill_breakdown: { tfng: { correct: 0, total: 1 } },
  review: [{
    q_num: 1,
    passage_order: 1,
    correct: false,
    user_answer: 'FALSE',
    expected: 'TRUE',
    question_type: 'true_false_not_given',
    prompt: 'Câu hỏi 1?',
    solution: FX.solution,
    // KHÔNG bịa: đây là thứ `build_stepper(solution)` dựng ra, chốt backend so
    // bằng nhau.
    stepper: FX.stepper,
  }],
};

export default {
  name: 'reading-review — trả lời micro-check SAI',
  route: `/reading/review?attempt_id=${ATTEMPT}`,
  legacyRoute: `/pages/reading-review.html?attempt_id=${ATTEMPT}`,
  settleMs: 900,
  drainMs: 1500,

  canned: [
    [/\/attempts\/[^/]+\/review$/, REVIEW],
  ],

  steps: [
    { wait: 900 },
    // MỞ THẺ trước. Khối lời giải `.rr-card__detail` để `hidden` cho tới khi bấm
    // vào đầu thẻ (`reading-review.js:471-487`) — micro-check nằm trong đó. Đếm
    // "có phần tử" thì thấy, nhưng người dùng thì chưa thấy gì.
    { click: '.rr-card__top' },
    { wait: 300 },
    { expectVisible: '[data-mc]' },
    // Bấm A trong khi đáp án là B ⇒ `correct: false`.
    { click: '[data-mc] [data-letter="A"]' },
    { wait: 400 },
    // Bấm LẦN NỮA: chốt `mc.dataset.done` phải chặn, không sinh thêm lần ghi.
    // Phát click theo DOM để vẫn thử được chốt one-shot sau khi UI đánh dấu
    // lựa chọn là aria-disabled. Cả legacy listener lẫn React handler đều phải
    // nhận sự kiện nhưng không được sinh lần ghi thứ hai.
    { dispatch: ['[data-mc] [data-letter="B"]', 'click'] },
    { wait: 400 },
  ],

  ignoreWrites: ['/api/analytics/events'],

  writes: [
    {
      method: 'POST',
      path: '/api/kp/microcheck-answers',
      // ĐÚNG MỘT lần, dù bấm hai lần.
      times: 1,
      body: (b) => b && Array.isArray(b.answers) && b.answers.length === 1
        && b.answers[0].correct === false
        && b.answers[0].kp && b.answers[0].kp.type === KP.type
        && b.answers[0].kp.slug === KP.slug
        && b.answers[0].kp.anchor === KP.anchor,
    },
  ],
};
