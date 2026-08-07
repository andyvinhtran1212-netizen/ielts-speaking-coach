// ĐƯỜNG CỨU BÀI của Speaking trong kỳ thi thử: trả nốt món "nợ báo điểm".
//
// BỐI CẢNH. Khi học viên thi thử xong phần Speaking, trang phải báo cho lượt thi
// biết những phiên nào thuộc về nó (`POST /api/mock-exams/sittings/{id}/speaking`).
// Nếu lời gọi đó hỏng — mạng chập, đóng tab, 500 — thì bài đã thu vẫn còn trên
// máy chủ nhưng LƯỢT THI KHÔNG BAO GIỜ CÓ ĐIỂM SPEAKING, và không có gì trên màn
// hình nói cho ai biết.
//
// Lưới an toàn: `speaking-debt.js` GHI NỢ vào localStorage TRƯỚC khi gửi, chỉ xoá
// khi máy chủ nhận, và trang chủ phát lại mỗi lần mở (`home.js:363`).
//
// VÌ SAO PHẢI CÓ BẢN KHAI RIÊNG: mọi luồng khác chạy đường LÀNH nên không chạm
// tới lưới này. Gỡ hẳn nó đi thì mọi cổng vẫn xanh — đúng cách một lỗi mất điểm
// im lặng quay lại. Đây cũng là lý do `speaking-debt.js` vừa được đưa vào `paths`
// ở #980: trước đó sửa riêng tệp này KHÔNG chạy cổng ghi lần nào.
import { FAKE_USER_ID } from '../supabase-session.mjs';

const KEY = 'mock-speaking-owed';           // `speaking-debt.js:23`
const SITTING = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const SESSIONS = ['11111111-1111-4111-8111-111111111111',
                  '22222222-2222-4222-8222-222222222222'];

export default {
  name: 'speaking — trả nốt nợ báo điểm khi mở trang chủ',
  route: '/home',
  legacyRoute: '/pages/home.html',
  nextPending: 'trang Next chưa tồn tại — bản khai dựng TRƯỚC khi port',
  settleMs: 1500,
  drainMs: 2000,

  // Món nợ ghi lại từ lần hỏng TRƯỚC. `user_id` phải là chính người đang đăng
  // nhập, nếu không lưới an toàn cố ý BỎ QUA nó (xem bản khai chị em).
  initStorage: {
    [KEY]: JSON.stringify([
      { sitting_id: SITTING, session_ids: SESSIONS, user_id: FAKE_USER_ID },
    ]),
  },

  canned: [
    // Hình dạng theo ĐÚNG thứ máy chủ trả (`services/student_home_aggregator.py:55-63`):
    // `student.name`, `streak`, `totals`, `skills`. Bản đầu tôi bịa
    // `{student:{display_name}, stats:{}}`, và trang ném TypeError ngay ở
    // `data.streak.current_days` — kéo theo bộ báo lỗi tự bắn một
    // `POST /api/error-logs` KHÔNG có trong bản khai, tức luồng đỏ vì lý do SAI.
    [/\/api\/student\/home-summary/, {
      student: { name: 'Học Viên', email: 'hv@local' },
      streak: { current_days: 0, longest_days: 0 },
      totals: { speaking_sessions: 0, writing_essays: 0 },
      // Trang duyệt THEO DANH SÁCH cố định `SKILLS_ORDER` và đọc thẳng
      // `data.skills[id].last_activity_at`; thiếu một kỹ năng là TypeError.
      // Đây là lần thứ hai trong cùng bản khai tôi bịa hình dạng rồi trang ném
      // lỗi — dữ liệu giả phải lấy theo thứ máy chủ TRẢ, không theo trí nhớ.
      // SÁU kỹ năng — đúng `SKILLS_ORDER` ở `home.js:13`, gồm cả `grammar` và
      // `vocabulary`. Tôi đoán "bốn kỹ năng" và trang lại ném lỗi: danh sách phải
      // ĐỌC từ trang, không suy từ tên sản phẩm.
      skills: Object.fromEntries(
        ['writing', 'speaking', 'grammar', 'vocabulary', 'reading', 'listening']
          .map((k) => [k, {
            status: 'active', last_activity_at: null,
            primary_cta: null, primary_cta_url: null,
          }])),
    }],
    [/\/auth\/me$/, { id: FAKE_USER_ID, display_name: 'Học Viên', permissions: ['all'] }],
    [/\/speaking$/, { ok: true }],
  ],

  steps: [
    { wait: 2500 },
    // Nợ phải được XOÁ sau khi máy chủ nhận. Không xoá thì mỗi lần mở trang chủ
    // lại gửi thêm một lần nữa, mãi mãi.
    { expectStorageAbsent: KEY },
  ],

  ignoreWrites: ['/api/analytics/events'],

  writes: [
    {
      method: 'POST',
      path: `/api/mock-exams/sittings/${SITTING}/speaking`,
      // Đủ CẢ HAI phiên. Gửi thiếu một phiên là lượt thi mất một phần điểm mà
      // vẫn trông như đã báo xong.
      body: (b) => b && Array.isArray(b.session_ids)
        && b.session_ids.length === SESSIONS.length
        && SESSIONS.every((s) => b.session_ids.includes(s)),
    },
  ],
};
