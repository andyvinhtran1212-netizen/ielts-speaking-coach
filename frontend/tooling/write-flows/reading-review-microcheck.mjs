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
const ATTEMPT = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const KP = { type: 'grammar', slug: 'thi-hien-tai-don', anchor: 'dinh-nghia' };

// Hình dạng theo đúng thứ trang ĐỌC (`reading-review.js:318-321, 360-376`):
// `stepper.steps[].kp_refs` + `.microcheck{prompt, options, answer}`, và
// `data-letter` được sinh theo THỨ TỰ A/B/C — không lấy từ dữ liệu.
const REVIEW = {
  // `passages` + `passage_order` là BẮT BUỘC: trang gom câu theo phần
  // (`reading-review.js:149-152`) rồi `sort` — thiếu là `undefined.sort` và cả
  // trang vào màn lỗi. Bỏ sót vì tôi chỉ nhìn phần render micro-check.
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
    solution: { band: 6, skill_name: 'TFNG' },
    stepper: {
      steps: [{
        action: 'scan',
        instruction_vi: 'Tìm từ khoá trong đoạn 2.',
        kp_refs: [KP],
        microcheck: {
          prompt: 'Câu nào đúng?',
          options: [{ text: 'Phương án A' }, { text: 'Phương án B' }],
          answer: 'B',                 // ⇒ bấm A là SAI, bấm B là ĐÚNG
        },
      }],
    },
  }],
};

export default {
  name: 'reading-review — trả lời micro-check SAI',
  route: '/reading/review',
  legacyRoute: `/pages/reading-review.html?attempt_id=${ATTEMPT}`,
  nextPending: 'trang Next chưa tồn tại — bản khai dựng TRƯỚC khi port',
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
    { click: '[data-mc] [data-letter="B"]' },
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
