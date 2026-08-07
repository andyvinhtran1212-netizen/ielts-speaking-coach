// Cùng trang, ĐƯỜNG HỎNG: máy chủ từ chối MỌI lần lưu.
//
// ĐÂY LÀ BẢN KHAI CỦA CHÍNH SỰ CỐ. Chú thích tại `reading-exam.js:1650` kể lại
// "một học viên làm hết hai section mà bị chấm 0 trong khi mọi bảng điều khiển
// đều xanh (26/07/2026)". Lưới an toàn dựng sau sự cố đó là một báo động: khi
// học viên rõ ràng ĐANG LÀM BÀI mà máy chủ chưa nhận được câu nào, trang bật
// cảnh báo đỏ và tự gửi một bản ghi lỗi — vì "gửi hỏng" thì KHÔNG để lại dấu vết
// nào ở phía máy chủ, nên không ai biết mà đi tìm.
//
// Ba bản khai kia đều chạy đường LÀNH, nên chúng không chạm được lưới an toàn
// này. Không có bản khai đường hỏng thì gỡ hẳn báo động đi mọi cổng vẫn xanh —
// đúng cách một sự cố im lặng quay lại (codex cục bộ #969).
//
// HAI CÔNG CỤ MỚI khiến bản khai này khả thi:
//   · `__status` trong dữ liệu trả sẵn — dựng được máy chủ lỗi;
//   · đồng hồ giả + bước `advance` — báo động đợi 45 GIÂY. Chờ thật thì một
//     luồng ăn gần một phút CI; hạ ngưỡng trong mã sản phẩm cho dễ kiểm thì làm
//     yếu đúng bảo đảm đang muốn ghim. Tua đồng hồ giữ nguyên cả hai.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { NO_BODY } from '../write-flow-core.mjs';

const FX = JSON.parse(readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/reading-exam.json'), 'utf8'));

const TEST = FX.test_id;
const ATTEMPT = FX.attempt_id;
const STARTED_AT = new Date().toISOString();
const A1 = 'con mèo';

export default {
  name: 'reading-exam — máy chủ từ chối mọi lần lưu (báo động)',
  route: '/reading/exam',
  legacyRoute: `/pages/reading-exam.html?test_id=${TEST}`,
  nextPending: 'trang Next chưa tồn tại — bản khai dựng TRƯỚC khi port',
  fakeClock: true,
  settleMs: 700,
  drainMs: 1500,

  canned: [
    [/\/api\/reading\/test\/[^/]+\/boot/, { test: FX.test, in_progress: null }],
    [/\/attempts$/, {
      attempt_id: ATTEMPT, started_at: STARTED_AT, time_limit_minutes: 60,
    }],
    // MỌI lần lưu đều hỏng. 5xx là lỗi ĐƯỢC THỬ LẠI
    // (`reading-exam.js:1527-1531`), nên đây là đường mà trang cố hết sức rồi
    // vẫn không lưu được — chứ không phải đường bỏ cuộc ngay.
    [/\/answers$/, { __status: 500, __body: { detail: 'lỗi máy chủ giả lập' } }],
    [/\/error-logs$/, { ok: true }],
  ],

  steps: [
    { wait: 700 },
    { click: '#exam-start-btn' },
    { wait: 700 },
    { fill: ['input[name="q-1"]', A1] },
    // Đồng hồ giả điều khiển cả `setTimeout` của trang, nên phải TUA chứ không
    // chờ: debounce 500ms, rồi ba lần thử lại giãn 400/1200/3000ms
    // (`_SAVE_RETRY_DELAYS`).
    { advance: 6000 },
    // Báo động soi mỗi 10 giây và chỉ nổ khi lần thử lưu ĐẦU TIÊN đã quá 45
    // giây (`_NOTHING_SAVED_AFTER_MS`). Tua qua ngưỡng đó.
    { advance: 50000 },
    // Tua thêm ba nhịp soi nữa (10s/nhịp). Chốt "chỉ báo MỘT lần cho mỗi lượt"
    // (`SESSION.nothing_reported`) chỉ quan sát được khi có NHIỀU nhịp quá hạn;
    // dừng ngay sau nhịp đầu thì gỡ hẳn chốt đó đi bản khai vẫn xanh.
    { advance: 30000 },
    // Cảnh báo phải HIỆN CHỮ cho học viên, không chỉ gửi bản ghi lỗi âm thầm:
    // người cứu được bài lúc đó là chính học viên và giám thị.
    { expectText: ['#exam-nothing-saved', 'MÁY CHỦ CHƯA NHẬN ĐƯỢC CÂU TRẢ LỜI NÀO'] },
  ],

  ignoreWrites: ['/api/analytics/events'],

  writes: [
    { method: 'POST', path: `/api/reading/test/${TEST}/attempts`, body: NO_BODY },
    {
      method: 'PATCH',
      path: `/api/reading/test/attempts/${ATTEMPT}/answers`,
      // 1 lần đầu + 3 lần thử lại. Ghim CON SỐ chứ không để lỏng: bỏ mất cơ chế
      // thử lại là học viên mất bài trong một sự cố mạng chớp nhoáng, mà cả bốn
      // request đều có thân giống hệt nhau nên không phép so thân nào thấy.
      times: 4,
      body: { q_num: 1, user_answer: A1 },
    },
    {
      method: 'POST',
      path: '/api/error-logs',
      // ĐÚNG MỘT LẦN cho mỗi lượt làm bài (`SESSION.nothing_reported`). Báo động
      // soi mỗi 10 giây; thiếu chốt chặn đó thì nó bắn liên tục và tự dìm mình
      // trong nhật ký.
      times: 1,
      body: {
        level: 'error',
        source: 'frontend',
        message: (v) => typeof v === 'string' && v.includes('no answer save has reached the server'),
        // Bản ghi phải NÊU ĐƯỢC lượt nào và mất bao nhiêu: thiếu hai thứ này thì
        // nhật ký chỉ nói "có chuyện xảy ra" mà không ai lần ra được học viên nào.
        extra: (e) => e && e.attempt_id === ATTEMPT && e.answers_held_locally === 1
          && typeof e.seconds_since_first_try === 'number' && e.seconds_since_first_try >= 45,
      },
    },
  ],
};
