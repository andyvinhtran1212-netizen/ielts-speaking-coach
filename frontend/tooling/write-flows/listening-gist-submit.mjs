// Luồng ghi của bài nghe nắm-ý-chính: mở bài → viết tóm tắt → nộp.
//
// Nhân từ khuôn `listening-mcq-*` (#962), nhưng đây là biến thể ĐÁNG kiểm nhất
// trong ba biến thể: bài làm là VĂN BẢN TỰ DO ở `user_transcript`, không phải
// mảng đáp án. Một bản port chép từ khuôn kia sang rất dễ giữ tên trường cũ, và
// hậu quả là bài viết của học viên không tới bộ chấm — nhưng trang vẫn hiện
// điểm, vì điểm đến từ phản hồi chứ không từ thứ vừa gửi.
//
// MỘT ĐƯỜNG GHI, BỐN TRƯỜNG DỄ HỎNG:
//   · `exercise_id` + `content_id` — sai là chấm vào bài khác.
//   · `mode: 'gist'` — sai là rơi vào nhánh chấm khác.
//   · `user_transcript` — chính bài làm; ghim NGUYÊN VĂN chứ không chỉ ghim
//     "có mặt", vì cắt chuỗi hay trim hỏng đều là mất bài của học viên.
//   · `listen_count` — `Math.max(1, …)`: chưa bấm nghe vẫn phải là 1.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { NO_DATA } from '../write-flow-core.mjs';

const FX = JSON.parse(readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/listening-gist.json'), 'utf8'));

const CONTENT = FX.content_id;
const EXERCISE = FX.exercise_id;
// Có dấu tiếng Việt, dấu nháy và xuống dòng — ba thứ hay bị mã hoá hỏng trên
// đường đi. Ghim nguyên văn thì một khâu escape sai sẽ ĐỎ ở đây thay vì lặng lẽ
// làm hỏng bài của học viên.
const ANSWER = "They agreed to postpone the meeting; it's now next Monday.\nBoth sides confirmed.";

export default {
  name: 'listening-gist — viết tóm tắt rồi nộp',
  route: '/listening/gist',
  legacyRoute: `/pages/listening-gist.html?content_id=${CONTENT}`,
  nextPending: 'trang Next chưa tồn tại — bản khai dựng TRƯỚC khi port',

  canned: [
    [/\/api\/listening\/content\//, {
      id: CONTENT,
      title: 'Bài nghe gist kiểm cổng ghi',
      // Trang bail sớm nếu thiếu (`listening-gist.js:56-58`).
      audio_signed_url: 'data:audio/mpeg;base64,SUQzAwAAAAAAAA==',
    }],
    [/\/api\/listening\/exercises\?/, {
      exercises: [{ id: EXERCISE, exercise_type: 'gist', payload: FX.payload }],
    }],
    // Khớp `_grade_and_save_gist`: `score` là 0-100 (KHÁC hai chế độ kia, vốn
    // dùng tỉ lệ [0,1]), kèm `feedback`, `keyword_matches`, `ai_used`.
    [/\/api\/listening\/attempts$/, {
      attempt_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      mode: 'gist', score: 85, is_first_attempt: true, is_correct: true,
      feedback: 'Nắm đúng ý chính.', keyword_matches: ['meeting'], ai_used: true,
    }],
  ],

  steps: [
    { wait: 600 },
    { fill: ['#answer', ANSWER] },
    { wait: 200 },
    // CỐ Ý KHÔNG bấm nghe: để kiểm `listen_count` phải là 1 chứ không phải 0.
    { click: '#btn-submit' },
  ],

  ignoreWrites: ['/api/analytics/events'],

  writes: [
    {
      method: 'POST',
      path: '/api/listening/attempts',
      body: {
        exercise_id: EXERCISE,
        content_id: CONTENT,
        mode: 'gist',
        user_transcript: ANSWER,
        listen_count: 1,
        // PHẢI VẮNG hoặc null. `listening_session_id: str | None`
        // (`routers/listening.py:331`) nên null LÀ hợp lệ — ghim "phải vắng hẳn" là
        // quá chặt, sẽ đỏ oan với một bản port tuần tự hoá đúng luật (bot bắt ở
        // #966). Thứ cần chặn là một session id THẬT: gửi kèm thì backend gắn
        // bài lẻ vào phiên và làm nhiễu thống kê (`listening.py:712-713`).
        listening_session_id: (v) => v == null,
        // Trường bài làm của HAI chế độ kia. Ghim để một bản port chép từ khuôn
        // MCQ/TF sang mà quên đổi sẽ ĐỎ.
        mcq_answers: NO_DATA,
        answers: NO_DATA,
      },
    },
  ],
};
