// Cùng trang, NHÁNH ĐỀ THI THỬ: cùng bài Đọc nhưng nằm trong một lượt thi 4 kỹ
// năng (`?sitting_id=…`).
//
// VÌ SAO PHẢI CÓ BẢN KHAI RIÊNG: `mock-exam-hook.js` nằm trong `paths` của cổng,
// nên sửa nó sẽ KHỞI ĐỘNG cổng — nhưng hai bản khai kia mở trang không kèm
// `sitting_id`, tức nhánh này không được chạy lần nào. Cổng chạy mà không kiểm
// đúng thứ vừa đổi còn tệ hơn cổng không chạy: báo cáo xanh đọc như đã phủ.
// (bot bắt ở #969)
//
// NHÁNH NÀY THÊM MỘT ĐƯỜNG GHI THỨ TƯ, và nó là loại FAIL-CLOSED:
//   POST /api/mock-exams/sittings/{sid}/attach   {section, attempt_id}
// Chú thích tại `mock-exam-hook.js:88-91` nói rõ vì sao: bài chỉ được niêm phong
// (giấu điểm) SAU KHI `sitting_id` được ghi lên lượt làm bài, nên attach hỏng mà
// vẫn cho làm tiếp là học viên nộp xong nhận điểm THẬT giữa một kỳ thi thử.
//
// Nên bản khai ghim cả THỨ TỰ: attach phải xảy ra NGAY SAU khi mở lượt và TRƯỚC
// mọi lần tự lưu. `judge` khớp theo con trỏ tiến nên thứ tự khai chính là thứ tự
// bắt buộc.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import base from './reading-exam-submit.mjs';

const FX = JSON.parse(readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/reading-exam.json'), 'utf8'));

const SITTING = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const A1 = 'con mèo';
const A2 = 'hai giờ';

export default {
  ...base,
  name: 'reading-exam — làm trong kỳ thi thử (niêm phong)',
  legacyRoute: `${base.legacyRoute}&sitting_id=${SITTING}`,

  canned: [
    ...base.canned.filter(([re]) => !/submit/.test(String(re))),
    [/\/mock-exams\/sittings\/[^/]+\/attach$/, { ok: true }],
    [/\/mock-exams\/sittings\//, { id: SITTING, status: 'in_progress' }],
    // Nộp trong kỳ thi thử KHÔNG trả điểm — chỉ `{received:true}`; trang nhận ra
    // qua `MockHook.isSealedResponse` (`mock-exam-hook.js:103-105`) rồi chuyển
    // sang màn "đã nộp, chờ kết quả" thay vì hiện điểm.
    [/\/submit$/, { received: true }],
  ],

  // Nộp xong PHẢI bàn giao lại cho trang điều phối kỳ thi. Trả sẵn
  // `{received:true}` chỉ kiểm ĐẦU VÀO của nhánh niêm phong; không có dòng này
  // thì trang có thể nhận response rồi đứng im mà bản khai vẫn xanh.
  expectFinalUrl: new RegExp(`/pages/mock-exam\\.html\\?sitting=${SITTING}&done=reading$`),

  writes: [
    base.writes[0],
    {
      method: 'POST',
      path: `/api/mock-exams/sittings/${SITTING}/attach`,
      // Ghim ĐÚNG lượt vừa mở, không chỉ "là một chuỗi": gắn nhầm lượt là niêm
      // phong nhầm bài, mà bài thật thì vẫn nộp ra điểm (bot bắt ở #969).
      body: { section: 'reading', attempt_id: FX.attempt_id },
    },
    base.writes[1],
    base.writes[2],
  ],
};
