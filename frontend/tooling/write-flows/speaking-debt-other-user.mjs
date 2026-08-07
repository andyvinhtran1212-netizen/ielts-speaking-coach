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
import { FAKE_USER_ID } from '../supabase-session.mjs';
import base from './speaking-debt-retry.mjs';

const KEY = 'mock-speaking-owed';
const NGUOI_KHAC = '99999999-9999-4999-8999-999999999999';
const SITTING_KHAC = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const SITTING_MINH = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const SESSIONS = ['11111111-1111-4111-8111-111111111111'];

// HAI món nợ: một của người khác, một của CHÍNH mình.
//
// Món của mình là ĐỐI CHỨNG, và nếu thiếu nó thì bản khai này là một oracle
// THUẦN ÂM: "không có đường ghi nào + nợ còn nguyên" cũng đúng khi `retryAll()`
// chưa từng chạy — vì trang chủ lỗi, vì phiên chưa sẵn sàng, vì bất cứ lý do gì.
// Khi đó luồng xanh mà không chứng minh được lưới an toàn còn sống.
//
// Có đối chứng thì bản khai đòi ĐỒNG THỜI hai điều: món của mình PHẢI được gửi
// (chứng minh `retryAll` đã chạy tới nơi), và món của người khác PHẢI ở lại.
// (codex cục bộ #982)
const NO_NGUOI_KHAC = { sitting_id: SITTING_KHAC, session_ids: SESSIONS, user_id: NGUOI_KHAC };
const NO_CUA_MINH = { sitting_id: SITTING_MINH, session_ids: SESSIONS, user_id: FAKE_USER_ID };
const CON_LAI = JSON.stringify([NO_NGUOI_KHAC]);

export default {
  ...base,
  name: 'speaking — KHÔNG phát lại nợ của người khác (máy dùng chung)',
  initStorage: { [KEY]: JSON.stringify([NO_NGUOI_KHAC, NO_CUA_MINH]) },

  steps: [
    { wait: 3000 },
    // Chỉ còn nợ của NGƯỜI KHÁC: món của mình đã trả và bị xoá, món kia còn
    // nguyên. Không gửi, mà cũng không xoá — xoá là làm mất bài của người khác,
    // đúng thứ mà việc "dọn cho sạch" dễ vô tình gây ra.
    { expectStorage: [KEY, CON_LAI] },
  ],

  writes: [
    {
      method: 'POST',
      // ĐÚNG lượt của mình. Bộ chạy coi mọi request ghi KHÔNG khai là lỗi, nên
      // một request gửi sang lượt của người khác sẽ đỏ với "write-undeclared" —
      // đó là cách ghim điều-KHÔNG-được-xảy-ra mà vẫn có đối chứng dương.
      path: `/api/mock-exams/sittings/${SITTING_MINH}/speaking`,
      body: (b) => b && Array.isArray(b.session_ids) && b.session_ids.length === 1,
    },
  ],
};
