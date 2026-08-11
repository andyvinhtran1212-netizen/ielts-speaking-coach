// Luồng 3 của bài nghe trắc nghiệm: BÁO LỖI BÀI NÀY.
//
// VÌ SAO CÓ: hai luồng kia cố ý không bấm góp ý, nên việc tôi bỏ `/api/feedback`
// khỏi `ignoreWrites` mới chỉ bắt được request TỰ BẮN — nó chưa hề ghim hợp đồng
// của widget. Bot chỉ ra ở #962: "không bấm" thì không chứng minh được gì về
// đường ghi đó.
//
// Widget `feedback-widgets.js` DÙNG CHUNG cho nhiều trang (reading, listening,
// review…), nên ghim một lần ở đây là ghim cho cả họ.
//
// NEO PHẢI ĐÚNG. `submit()` chọn neo theo ngữ cảnh: `attempt_id` (khi xem lại
// bài thi) HOẶC `content_id` / `passage_slug` (bài lẻ) — `feedback-widgets.js:40-49`.
// Trang này gắn widget với `contentId`, KHÔNG có attempt. Gửi nhầm `attempt_id`
// là gắn báo lỗi vào một lượt làm bài không liên quan, nên nó được ghim là PHẢI
// VẮNG — bộ so chỉ khớp tập con nên không ghim thì gửi thừa vẫn xanh.
import base from './listening-mcq-submit.mjs';

const NOTE = 'Câu 2 nghe không rõ.';

export default {
  ...base,
  name: 'listening-mcq — báo lỗi bài này',
  steps: [
    { wait: 600 },
    // Nút do widget dựng động sau khi bài tải xong.
    { click: '.fb-flag-btn' },
    { wait: 200 },
    { fill: ['.fb-pop textarea', NOTE] },
    { click: '.fb-pop [data-act="send"]' },
  ],
  writes: [{
    method: 'POST',
    path: '/api/feedback',
    body: {
      skill: 'listening',
      type: 'flag',
      content_id: base.writes[0].body.content_id,
      note: NOTE,
      // Bài lẻ KHÔNG có lượt làm bài để neo vào.
      // PHẢI VẮNG hoặc null. `feedback-widgets.js:42` chỉ thêm khoá khi có giá
      // trị, và model khai `attempt_id: Optional[str]` (`routers/feedback.py:48`)
      // nên null cũng hợp lệ — ghim "phải vắng hẳn" ở đây là quá chặt. Thứ cần
      // chặn là một attempt id THẬT: cờ theo NỘI DUNG mà gắn vào một lượt làm
      // bài là neo sai chỗ.
      attempt_id: (v) => v == null,
    },
  }],
};
