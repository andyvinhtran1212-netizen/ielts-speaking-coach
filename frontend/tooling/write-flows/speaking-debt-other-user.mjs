// Cùng lưới an toàn, CHIỀU NGƯỢC: nợ của NGƯỜI KHÁC thì KHÔNG được phát lại.
//
// `localStorage` thuộc về cả origin chứ không thuộc về tài khoản. Trên một máy
// dùng chung — phòng máy, máy nhà, quán net — món nợ do học viên A để lại vẫn
// nằm đó khi học viên B đăng nhập. Phát lại nó là gửi phiên của A dưới danh
// nghĩa B: máy chủ trả 403, và tệ hơn, nó cho B biết A vừa thi lượt nào. Chú
// thích ở `speaking-debt.js:17-19` ghi đúng rủi ro này, và chốt chặn nằm ở dòng
// 109 (`owed.user_id !== me` thì bỏ qua).
//
// Bản khai này ghim rằng chốt đó CÒN SỐNG: đúng cùng kịch bản với bản khai chị
// em, chỉ khác chủ nợ — và đường ghi phải KHÔNG xảy ra, còn món nợ phải được GIỮ
// NGUYÊN cho chủ thật của nó quay lại.
import base from './speaking-debt-retry.mjs';

const KEY = 'mock-speaking-owed';
const NGUOI_KHAC = '99999999-9999-4999-8999-999999999999';
const SITTING = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const SESSIONS = ['11111111-1111-4111-8111-111111111111',
                  '22222222-2222-4222-8222-222222222222'];
const NO = JSON.stringify([
  { sitting_id: SITTING, session_ids: SESSIONS, user_id: NGUOI_KHAC },
]);

export default {
  ...base,
  name: 'speaking — KHÔNG phát lại nợ của người khác (máy dùng chung)',
  initStorage: { [KEY]: NO },

  steps: [
    { wait: 2500 },
    // Nợ phải còn NGUYÊN VẸN: không gửi, mà cũng không xoá. Xoá là làm mất bài
    // của người khác, đúng thứ mà việc "dọn cho sạch" dễ vô tình gây ra.
    { expectStorage: [KEY, NO] },
  ],

  // KHÔNG có đường ghi nào — và phải KHAI RA điều đó. Bộ chạy coi mọi request ghi
  // không khai là LỖI, nên nếu lưới an toàn hỏng và nó vẫn gửi, luồng đỏ với
  // "write-undeclared". Cờ `expectNoWrites` để bộ kiểm lược đồ phân biệt "cố ý
  // không ghi" với "quên viết `writes`" — hai thứ trông giống hệt nhau.
  expectNoWrites: true,
  writes: [],
};
