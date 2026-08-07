// Cùng trang, nhánh KHÁC — và là nhánh QUAN TRỌNG NHẤT của cả bộ:
// gõ đáp án rồi bấm Nộp NGAY, trước khi debounce 500ms kịp chạy.
//
// Đây đúng hình dạng sự cố thật ghi trong `reading-exam.js:1650`: "một học viên
// làm hết hai section mà bị chấm 0 trong khi mọi bảng điều khiển đều xanh
// (26/07/2026)". Câu trả lời gõ sát lúc nộp là câu dễ mất nhất, vì nó chỉ tồn
// tại trong bộ nhớ trang cho tới khi một trong hai lưới an toàn bắt được:
//   · `_flushPendingSaves()` — đẩy nốt các ô còn treo, HOẶC
//   · thân request `/submit` — vốn gom lại từ toàn bộ đáp án đang giữ.
//
// Bản khai ghim CẢ HAI, vì mất một trong hai vẫn còn cái kia che, và đúng kiểu
// che đó khiến lỗi sống sót qua nhiều đợt review: bỏ `flush` đi thì màn hình vẫn
// xanh, điểm vẫn đúng, chỉ mất dấu vết ở máy chủ.
import base from './reading-exam-submit.mjs';

const A1 = 'con mèo';
const A2 = 'hai giờ';

export default {
  ...base,
  name: 'reading-exam — gõ xong nộp NGAY, không kịp tự lưu',
  steps: [
    { wait: 700 },
    { click: '#exam-start-btn' },
    { wait: 700 },
    { fill: ['input[name="q-1"]', A1] },
    { click: '#exam-passage' },
    { wait: 900 },                        // câu 1 đã kịp tự lưu
    { fill: ['input[name="q-2"]', A2] },  // câu 2 thì CHƯA
    { click: '#exam-submit-btn' },        // nộp ngay, debounce chưa chạy
    { wait: 300 },
    { click: '#exam-submit-confirm' },
    { wait: 500 },
  ],
  writes: [
    base.writes[0],
    {
      ...base.writes[1],
      // 2 lần: câu 1 theo debounce, câu 2 do flush đẩy nốt lúc nộp.
      times: 2,
    },
    base.writes[2],
  ],
};
