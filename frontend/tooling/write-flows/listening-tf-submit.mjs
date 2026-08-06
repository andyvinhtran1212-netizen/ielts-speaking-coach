// Luồng ghi của bài nghe Đúng/Sai/Không có: mở bài → chọn T/F/NG → nộp.
//
// Nhân từ khuôn `listening-mcq-*` (#962) — cùng một đích ghi
// `POST /api/listening/attempts`, khác ở tên trường bài làm và `mode`. Đó chính
// là điều đáng kiểm: một bản port rất dễ mang nguyên `mcq_answers` sang, và
// không phép so DOM nào thấy được.
//
// KHAI TRƯỚC, PORT SAU: bản khai này phải xanh trên trang LEGACY trước khi có
// một dòng React nào, để nó là hợp đồng độc lập.
//
// MỘT ĐƯỜNG GHI, NĂM TRƯỜNG DỄ HỎNG:
//   · `exercise_id` + `content_id` — sai là chấm vào bài khác.
//   · `mode: 'true_false'` — KHÔNG phải `tf`. Backend chỉ nhận đúng chuỗi này
//     (`routers/listening.py:571-576`), và nó cũng là tên `exercise_type` trong
//     câu GET, nên viết tắt là trang rỗng chứ không phải nộp sai.
//   · `answers` — mảng CHUỖI 'T'/'F'/'NG', không phải chỉ số như bên MCQ.
//   · `listen_count` — `Math.max(1, …)`: nộp mà CHƯA BẤM NGHE vẫn phải là 1.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { NO_DATA } from '../write-flow-core.mjs';

// Dữ liệu giả đọc từ tệp JSON dùng chung, và `backend/tests/test_write_flow_fixtures.py`
// cho nó chạy qua CHÍNH `_validate_true_false_payload` của production. Xem lịch
// sử #962: ba vòng review liên tiếp bắt lỗi "dữ liệu giả mô tả trạng thái backend
// không bao giờ chấp nhận", vì cổng chặn mạng nên nó vẫn xanh.
const FX = JSON.parse(readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/listening-tf.json'), 'utf8'));

const CONTENT = FX.content_id;
const EXERCISE = FX.exercise_id;

export default {
  name: 'listening-tf — chọn T/F/NG rồi nộp',
  route: '/listening/tf',
  legacyRoute: `/pages/listening-tf.html?content_id=${CONTENT}`,
  nextPending: 'trang Next chưa tồn tại — bản khai dựng TRƯỚC khi port',

  canned: [
    [/\/api\/listening\/content\//, {
      id: CONTENT,
      title: 'Bài nghe T/F kiểm cổng ghi',
      // Trang bail sớm nếu thiếu trường này (`listening-tf.js:58-60`) — bỏ quên
      // là không câu nào render và luồng đỏ ở bước bấm.
      audio_signed_url: 'data:audio/mpeg;base64,SUQzAwAAAAAAAA==',
    }],
    [/\/api\/listening\/exercises\?/, {
      exercises: [{ id: EXERCISE, exercise_type: 'true_false', payload: FX.payload }],
    }],
    // Hình dạng phản hồi khớp bộ chấm thật (`_grade_and_save_true_false`):
    // `score` là tỉ lệ [0,1], `correct` là SỐ câu đúng, `details[]` song song
    // với `statements[]` — trang đọc `details` khi vẽ lại từng câu
    // (`listening-tf.js:115-119`), thiếu thì nó ném lỗi JS và luồng đỏ.
    [/\/api\/listening\/attempts$/, {
      attempt_id: '99999999-9999-4999-8999-999999999999',
      mode: 'true_false', score: 1, correct: 3, total: 3, is_correct: true,
      details: [
        { idx: 0, actual: 'T', expected: 'T', is_correct: true },
        { idx: 1, actual: 'F', expected: 'F', is_correct: true },
        { idx: 2, actual: 'NG', expected: 'NG', is_correct: true },
      ],
    }],
  ],

  steps: [
    { wait: 600 },
    // Radio do JS sinh chứ không có sẵn trong HTML (`listening-tf.js:137-145`),
    // nên phải chờ dữ liệu về rồi mới bấm được.
    { click: 'input[name="tf-0"][value="T"]' },
    { click: 'input[name="tf-1"][value="F"]' },
    { click: 'input[name="tf-2"][value="NG"]' },
    { wait: 200 },
    // CỐ Ý KHÔNG bấm nghe: để kiểm `listen_count` phải là 1 chứ không phải 0.
    { click: '#btn-submit' },
  ],

  // CHỈ telemetry mới được bỏ qua. `/api/feedback` KHÔNG nằm ở đây: luồng này
  // không bấm góp ý, nên một request feedback bắn ra là bất thường và phải đỏ.
  ignoreWrites: ['/api/analytics/events'],

  writes: [
    {
      method: 'POST',
      path: '/api/listening/attempts',
      body: {
        exercise_id: EXERCISE,
        content_id: CONTENT,
        mode: 'true_false',
        answers: ['T', 'F', 'NG'],
        listen_count: 1,
        // PHẢI VẮNG — bài lẻ không thuộc phiên nào. Bộ so chỉ khớp TẬP CON nên
        // không ghim thì bản port gửi thừa trường này vẫn xanh.
        // PHẢI VẮNG hoặc null. `listening_session_id: str | None`
        // (`routers/listening.py:331`) nên null LÀ hợp lệ — ghim "phải vắng hẳn" là
        // quá chặt, sẽ đỏ oan với một bản port tuần tự hoá đúng luật (bot bắt ở
        // #966). Thứ cần chặn là một session id THẬT: gửi kèm thì backend gắn
        // bài lẻ vào phiên và làm nhiễu thống kê (`listening.py:712-713`).
        listening_session_id: (v) => v == null,
        // Trường bài làm của HAI chế độ kia. Ghim để một bản port chép từ khuôn
        // khác sang mà quên đổi sẽ ĐỎ chứ không âm thầm gửi cả hai.
        mcq_answers: NO_DATA,
        user_transcript: NO_DATA,
      },
    },
  ],
};
