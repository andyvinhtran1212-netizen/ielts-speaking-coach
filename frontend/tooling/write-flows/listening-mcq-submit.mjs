// Luồng ghi của bài nghe trắc nghiệm: mở bài → chọn đáp án → nộp.
//
// KHAI TRƯỚC, PORT SAU — cùng thứ tự đã dùng cho trang Bài viết (#947). Bản khai
// này phải xanh trên trang LEGACY trước khi có một dòng React nào, để nó là hợp
// đồng độc lập chứ không phải bản mô tả lại thứ tôi vừa viết.
//
// ĐÂY LÀ THÍ ĐIỂM cho nhóm 28 trang có-ghi còn lại. `listening-tf` và
// `listening-gist` gần như y hệt (cùng 2 đích ghi, cùng khuôn), nên khuôn khai
// này dùng lại được.
//
// MỘT ĐƯỜNG GHI, BỐN TRƯỜNG DỄ HỎNG:
//   · `exercise_id` + `content_id` — sai là chấm vào bài NGƯỜI KHÁC hoặc bài khác.
//   · `mode: 'mcq'` — sai là bản ghi rơi vào nhánh chấm khác.
//   · `mcq_answers` — chính bài làm; mất là mất bài.
//   · `listen_count` — `Math.max(1, …)`, tức nộp mà CHƯA BẤM NGHE vẫn phải là 1,
//     không phải 0. Đây là chi tiết một bản port rất dễ "đơn giản hoá" thành 0,
//     và không phép so DOM nào thấy được.
const CONTENT = 'ct-1';
const EXERCISE = 'ex-1';

// Hình dạng câu hỏi phải khớp thứ UI ĐỌC và thứ backend BẢO ĐẢM, nếu không bản
// khai chạy trên một trạng thái production không thể sinh ra:
//   · UI đọc `stem` và `idx` (`listening-mcq.js:82-83`) — bản đầu tôi viết
//     `prompt`, tức câu hỏi render ra KHÔNG có chữ mà bản khai vẫn xanh;
//   · backend bảo đảm ĐÚNG 4 lựa chọn (`routers/listening.py:163-171`) — bản đầu
//     tôi để 3.
// (review cục bộ bắt cả hai ở #961)
const QUESTIONS = [
  { idx: 0, stem: 'Câu 1?', options: ['A', 'B', 'C', 'D'] },
  { idx: 1, stem: 'Câu 2?', options: ['A', 'B', 'C', 'D'] },
];

export default {
  name: 'listening-mcq — chọn đáp án rồi nộp',
  route: '/listening/mcq',
  legacyRoute: `/pages/listening-mcq.html?content_id=${CONTENT}`,
  // GỠ khi route Next lên; lúc đó bản khai phải xanh trên CẢ HAI vế.
  nextPending: 'trang Next chưa tồn tại — bản khai dựng TRƯỚC khi port',

  canned: [
    [/\/api\/listening\/content\//, {
      id: CONTENT,
      title: 'Bài nghe kiểm cổng ghi',
      // Trang bail sớm nếu thiếu trường này — bỏ quên là không câu hỏi nào render.
      audio_signed_url: 'data:audio/mpeg;base64,SUQzAwAAAAAAAA==',
    }],
    [/\/api\/listening\/exercises\?/, {
      exercises: [{ id: EXERCISE, exercise_type: 'mcq', payload: { questions: QUESTIONS } }],
    }],
    // Hình dạng phản hồi khớp bộ chấm thật: `score` là tỉ lệ [0,1] và `correct`
    // là SỐ câu đúng (`services/listening_grader.py:604-610`) — không phải mảng
    // boolean như bản đầu tôi bịa ra.
    [/\/api\/listening\/attempts$/, { score: 1, total: 2, correct: 2 }],
  ],

  steps: [
    { wait: 600 },
    // Chọn đáp án cho cả hai câu. Bản render dùng `<input type="radio"
    // name="mcq-{i}" value="{j}">`, nên đây là đúng phần tử người dùng bấm.
    { click: 'input[name="mcq-0"][value="1"]' },
    { click: 'input[name="mcq-1"][value="2"]' },
    { wait: 200 },
    // CỐ Ý KHÔNG bấm nghe: để kiểm `listen_count` phải là 1 chứ không phải 0.
    { click: '#btn-submit' },
  ],

  // CHỈ telemetry mới được bỏ qua. `/api/feedback` KHÔNG phải telemetry — nó là
  // đường ghi thật của widget góp ý (`feedback-widgets.js:328`), và bản đầu tôi
  // cho nó vào đây là tự che một đường ghi. Nay nó KHÔNG được bỏ qua: luồng này
  // không bấm góp ý, nên nếu có request feedback nào bắn ra thì đó là bất thường
  // và phải đỏ.
  ignoreWrites: ['/api/analytics/events'],

  writes: [
    {
      method: 'POST',
      path: '/api/listening/attempts',
      body: {
        exercise_id: EXERCISE,
        content_id: CONTENT,
        mode: 'mcq',
        mcq_answers: [1, 2],
        listen_count: 1,
        // PHẢI VẮNG. Bài làm lẻ không thuộc phiên nào; gửi kèm session id là
        // backend gắn nó vào phiên và làm nhiễu thống kê
        // (`routers/listening.py:712-713`). Bộ so chỉ khớp TẬP CON nên không
        // ghim thì một bản port gửi thừa trường này vẫn xanh.
        listening_session_id: (v) => v == null,
      },
    },
  ],
};
