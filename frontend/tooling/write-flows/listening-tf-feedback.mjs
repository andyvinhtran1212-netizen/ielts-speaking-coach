// Luồng BÁO LỖI BÀI NÀY của trang tf.
//
// VÌ SAO CẦN RIÊNG, dù widget `feedback-widgets.js` dùng chung và đã được ghim
// một lần ở `listening-mcq-feedback.mjs`: thứ dễ rơi lúc port KHÔNG phải widget
// mà là LỜI GỌI `AverFeedback.attachCardFlag({...})` của riêng từng trang —
// mỗi trang tự chọn phần tử neo, `skill`, và `contentId`. Bốn luồng nộp bài của
// hai trang mới đều xanh kể cả khi lời gọi đó bị bỏ hẳn.
//
// Tôi đã lập luận sai chuyện này một lần ("cùng đường mã, không cần lặp") — bot
// bắt ở #966 vòng 4. Cùng đường mã ở KHÂU GỬI, khác nhau ở khâu GẮN.
//
// NEO PHẢI ĐÚNG: trang gắn widget với `contentId`, không có lượt làm bài nào để
// neo vào, nên `attempt_id` phải vắng hoặc null (`feedback-widgets.js:40-49`).
import base from './listening-tf-submit.mjs';

const NOTE = 'Đoạn giữa nghe không rõ.';

export default {
  ...base,
  name: 'listening-tf — báo lỗi bài này',
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
      attempt_id: (v) => v == null,
    },
  }],
};
