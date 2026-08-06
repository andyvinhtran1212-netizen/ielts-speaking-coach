// Cùng trang, nhánh KHÁC: nghe HAI lần rồi mới nộp.
//
// Tệp riêng chứ không phải mảng trong tệp trên: bộ chạy chỉ nạp `default` của
// mỗi tệp.
//
// VÌ SAO CẦN: bản khai nộp-thẳng chỉ kiểm được nhánh "chưa nghe lần nào", tức nó
// vẫn xanh kể cả khi bộ đếm lượt nghe hỏng hoàn toàn. Ở đây phát ĐÚNG sự kiện
// `play` lên `<audio>` bên trong component để đi qua cả khâu chuyển tiếp
// `play → av-audio-play` — phát thẳng `av-audio-play` lên host là vòng qua đúng
// chỗ dễ hỏng nhất (bot bắt ở #962).
import base from './listening-tf-submit.mjs';

export default {
  ...base,
  name: 'listening-tf — nghe hai lần rồi nộp',
  steps: [
    { wait: 600 },
    { dispatch: ['#player', 'play', '_audio'] },
    { wait: 150 },
    { dispatch: ['#player', 'play', '_audio'] },
    { wait: 150 },
    { click: 'input[name="tf-0"][value="T"]' },
    { click: 'input[name="tf-1"][value="F"]' },
    { click: 'input[name="tf-2"][value="NG"]' },
    { wait: 200 },
    { click: '#btn-submit' },
  ],
  writes: [{
    ...base.writes[0],
    body: { ...base.writes[0].body, listen_count: 2 },
  }],
};
