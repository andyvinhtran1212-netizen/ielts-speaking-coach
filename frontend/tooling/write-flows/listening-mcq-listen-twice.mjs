// Luồng 2 của bài nghe trắc nghiệm: NGHE HAI LẦN rồi nộp.
//
// VÌ SAO TÁCH TỆP chứ không thêm export vào luồng 1: bộ chạy chỉ nạp `default`
// của mỗi tệp (`verify-write-flows.mjs:168`). Bản đầu tôi viết luồng này thành
// một export phụ cùng tệp — nó sẽ KHÔNG BAO GIỜ CHẠY, tức một chốt chết mà vẫn
// trông như đã có.
//
// VÌ SAO CẦN LUỒNG NÀY: luồng 1 cố ý không bấm nghe, nên nó chỉ kiểm nhánh clamp
// `Math.max(1, 0)` → 1. Nghĩa là nó VẪN XANH kể cả khi bộ đếm lượt nghe hỏng
// hoàn toàn — không có trình phát, hoặc listener `av-audio-play` không gắn
// (`listening-mcq.js:235`). Ở đây phát sự kiện đó hai lần và đòi `listen_count`
// bằng 2, tức bộ đếm phải thật sự chạy. (review cục bộ chỉ ra ở #961)
import base from './listening-mcq-submit.mjs';

export default {
  ...base,
  name: 'listening-mcq — nghe hai lần rồi nộp',
  steps: [
    { wait: 600 },
    { dispatch: ['#player', 'av-audio-play'] },
    { dispatch: ['#player', 'av-audio-play'] },
    { click: 'input[name="mcq-0"][value="1"]' },
    { click: 'input[name="mcq-1"][value="2"]' },
    { wait: 200 },
    { click: '#btn-submit' },
  ],
  writes: [{ ...base.writes[0], body: { ...base.writes[0].body, listen_count: 2 } }],
};
