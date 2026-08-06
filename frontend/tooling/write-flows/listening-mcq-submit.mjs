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
// DỮ LIỆU GIẢ NẰM Ở TỆP JSON DÙNG CHUNG, không viết thẳng vào đây.
//
// Cổng này chặn mạng và trả dữ liệu sẵn, nên bản khai vẫn XANH kể cả khi dữ liệu
// giả mô tả một trạng thái production KHÔNG THỂ tồn tại. Trong PR này chuyện đó
// xảy ra BA lần: `prompt` thay cho `stem` + 3 lựa chọn (#961), `content_id` là
// `ct-1` trong khi backend đòi UUID (vòng 3), thiếu `answer_idx` (vòng 4). Mỗi
// lần đều do người review bắt, không lần nào máy bắt được.
//
// Ba lần cùng MỘT LOẠI sai là hỏng thiết kế chứ không phải ba việc phải vá. Gốc:
// dữ liệu giả ở JS, định nghĩa "hợp lệ" ở Python, không gì nối hai đầu. Nay tệp
// JSON là nguồn duy nhất và `backend/tests/test_write_flow_fixtures.py` cho nó
// chạy qua CHÍNH `_validate_mcq_payload` của production — không viết lại bộ kiểm,
// vì bản sao thứ hai rồi cũng trôi.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ABSENT } from '../write-flow-core.mjs';

const FX = JSON.parse(readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/listening-mcq.json'), 'utf8'));

const CONTENT = FX.content_id;
const EXERCISE = FX.exercise_id;
// UI đọc `stem` và `idx` (`listening-mcq.js:82-83`); backend bảo đảm ĐÚNG 4 lựa
// chọn và bắt buộc `answer_idx` (`routers/listening.py:163-171`). Cả bốn ràng
// buộc nay do chốt backend giữ, không còn do tôi nhớ.
const QUESTIONS = FX.payload.questions;

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
      exercises: [{ id: EXERCISE, exercise_type: 'mcq', payload: FX.payload }],
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
        //
        // `ABSENT` chứ không phải `(v) => v == null`: cách viết kia nhận cả
        // `answers: null`, tức một bản port chép nhầm khuôn vẫn xanh dù backend
        // từ chối (codex review cục bộ bắt ở #966).
        listening_session_id: ABSENT,
        // Trường bài làm của HAI chế độ kia — ba trang Listening dùng chung một
        // đích ghi nên đây là chỗ chép nhầm khuôn dễ xảy ra nhất.
        answers: ABSENT,
        user_transcript: ABSENT,
      },
    },
  ],
};
