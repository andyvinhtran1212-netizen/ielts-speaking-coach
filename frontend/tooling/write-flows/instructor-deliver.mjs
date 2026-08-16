// Trang CHẤM BÀI của giảng viên: viết nhận xét → TRẢ BÀI cho học viên.
//
// VÌ SAO GHIM TRANG NÀY: đây là đường ghi có hậu quả nặng nhất trong nhóm còn
// lại, vì nó đổi thứ HỌC VIÊN NHÌN THẤY và không tự sửa được.
//
// BA ĐIỀU ĐƯỢC GHIM, mỗi cái một kiểu hỏng riêng:
//
//   · THỨ TỰ. `onDeliver` lưu nhận xét TRƯỚC rồi mới trả bài
//     (`instructor-grade.js:154-156`). Đảo lại — hoặc bỏ lệnh lưu — thì học
//     viên nhận được bài mà KHÔNG kèm nhận xét của giáo viên, và không màn hình
//     nào của giáo viên tố cáo: ô nhận xét vẫn đầy chữ trên máy họ. Bộ so khớp
//     theo con trỏ tiến nên thứ tự khai ở đây LÀ điều kiện, không phải trang trí.
//
//   · `as_instructor` phải tới được CẢ HAI lệnh ghi. Link từ danh sách chấm mang
//     `?as_instructor=`, và `IMP()` (dòng 19-22) nối nó vào mọi đường `/instructor`.
//     Mất nó thì lệnh ghi được quy cho SAI NGƯỜI — bài vẫn trả, nhận xét vẫn lưu,
//     chỉ có sổ ghi nhầm ai đã chấm. Cùng lớp lỗi với `class_item` ở
//     `listening-test-class-item`, và cũng chỉ ghim được bằng `query`:
//     `normalizePath` cắt bỏ chuỗi truy vấn nên nhét vào `path` là ghim hụt.
//
//   · ĐÚNG MỘT LẦN mỗi lệnh. Trả bài hai lần là hai lần thông báo tới học viên.
//
// KHÔNG ghim `regrade` và `revoke-delivery` trong luồng này: chúng là hai hành
// động KHÁC, mỗi cái cần luồng riêng với đối chứng riêng. Gộp vào đây thì một
// bản khai phải mô tả bốn nhánh và không nhánh nào được kiểm kỹ.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FX = JSON.parse(readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/instructor-deliver.json'), 'utf8'));

const ESSAY = FX.essay_id;
const REVIEW = FX.review_id;
const AS = FX.as_instructor;

export default {
  name: 'instructor-grade — lưu nhận xét rồi TRẢ BÀI',
  route: `/instructor/grade?essay_id=${ESSAY}&review_id=${REVIEW}&as_instructor=${AS}`,
  legacyRoute: `/pages/instructor/grade.html?essay_id=${ESSAY}&review_id=${REVIEW}&as_instructor=${AS}`,
  settleMs: 900,
  drainMs: 1500,

  canned: [
    // Chốt vai trò: không phải instructor/admin thì trang đá về `/home` và
    // không có gì để kiểm.
    // NGƯỜI GỌI LÀ ADMIN, mục tiêu mượn danh là một GV KHÁC. `_me()`
    // (`routers/instructor.py:101-113`) BỎ QUA `?as_instructor` với người gọi
    // không phải admin — nên để `/auth/me` trùng luôn id mượn danh là mô hình
    // hoá đúng cái ca mà tham số ấy VÔ TÁC DỤNG, trong khi bản khai lại tuyên
    // bố nó bảo vệ việc quy trách nhiệm.
    [/\/auth\/me/, FX.me],
    [/\/instructor\/essays\/[^/?]+\/versions(\?|$)/, {
      versions: [{
        version: 1, source: 'ai_pro', overall_band_score: FX.essay.band_overall,
        created_at: '2026-08-16T00:00:00Z', feedback_json: FX.essay.feedback.feedback_json,
      }],
      budget: { live_count: 1, max: 3, can_compose: true },
    }],
    [/\/instructor\/reviews\/queue(\?|$)/, [{
      essay_id: ESSAY, review: { id: REVIEW, status: 'claimed' },
      student_email: 'student@local', task_type: FX.essay.task_type,
    }]],
    [/\/instructor\/essays\/[^/?]+(\?|$)/, FX.essay],
    [/\/instructor-note/, { essay_id: ESSAY, instructor_note: FX.instructor_note, status: 'reviewed' }],
    [/\/deliver/, { id: REVIEW, essay_id: ESSAY, status: 'delivered' }],
  ],

  steps: [
    { wait: 900 },
    { expectVisible: '#ig-deliver' },
    // MÀN HÌNH PHẢI ĐÚNG LÀ MÀN HÌNH ĐANG KIỂM. Dữ liệu giả bản đầu để `feedback`
    // sai hình dạng (`band_scores`/`summary` thay vì một dòng
    // `writing_feedback_current`), nên trang đi nhánh «Chưa có phân tích AI.» và
    // hiện band «—» — luồng vẫn XANH nhưng đang chạy trên một màn hình khác với
    // màn hình nó tuyên bố kiểm (bot bắt ở #1011). Hai khẳng định dưới đây biến
    // chuyện đó thành lỗi đỏ.
    { expectText: ['#ig-band', 'Band 6.5'] },
    { expectVisible: '#ig-ai .ig-sec' },
    // BIỂU NGỮ MƯỢN DANH phải hiện. `instructor-grade.js:50` chỉ bỏ `hidden` khi
    // `?as_instructor` CÓ MẶT — nên đây là bằng chứng nhìn thấy được rằng trang
    // đang chạy đúng đường mượn danh, chứ không phải một phiên GV thường mà tôi
    // dán thêm tham số vào URL.
    { expectVisible: '#ig-imp' },
    { fill: ['#ig-comment', FX.instructor_note] },
    { wait: 200 },
    { click: '#ig-deliver' },
    { wait: 600 },
  ],

  ignoreWrites: ['/api/analytics/events'],

  // THỨ TỰ KHAI = thứ tự bắt buộc. Lưu nhận xét đứng TRƯỚC.
  writes: [
    {
      method: 'PATCH',
      path: `/instructor/essays/${ESSAY}/instructor-note`,
      times: 1,
      query: { as_instructor: AS },
      // Đúng chữ trong ô nhận xét. `InstructorNoteBody.instructor_note` khai
      // `str` (mặc định rỗng), nên gửi null/số là 422 — mà trang vẫn báo
      // "Đã lưu nhận xét." vì lỗi rơi vào nhánh catch chung.
      body: { instructor_note: FX.instructor_note },
    },
    {
      method: 'POST',
      path: `/instructor/reviews/${REVIEW}/deliver`,
      times: 1,
      query: { as_instructor: AS },
      body: { essay_id: ESSAY, instructor_note: FX.instructor_note },
    },
  ],
};
