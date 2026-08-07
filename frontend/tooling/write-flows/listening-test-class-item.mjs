// Bài nghe ĐẦY ĐỦ làm theo BÀI GIAO: mở đề từ trang lớp → làm → nộp.
//
// VÌ SAO GHIM TRANG NÀY TRƯỚC trong nhóm còn lại: đây là đường ghi mà một bản
// port hỏng KHÔNG để lại dấu vết nào trên màn hình. Trang lớp gắn `?class_item=`
// vào link đề; tham số đó phải đi tiếp vào lệnh TẠO LƯỢT LÀM để bản ghi biết nó
// thuộc lần giao nào. Mất nó thì mọi thứ người dùng thấy vẫn đúng — đề mở được,
// đáp án lưu được, bài chấm ra điểm — chỉ có sổ bài giao là mãi mãi trống, và em
// học viên bị ghi là chưa nộp.
//
// Backend nói rõ điều này ở `routers/listening.py:5053-5090`: `class_item` là
// THAM SỐ TRUY VẤN, và khi có mặt nó được `validate_class_item_for_test` kiểm.
// Không có tham số thì không có gì để kiểm — backend không thể tự đoán ra, và
// chú thích ngay trong `listening-test-player.js:187-191` cũng nói đúng vậy:
// suy ngược từ đề bài và đồng hồ là việc KHÔNG làm đúng được khi cùng một đề có
// thể được giao hai lần, hoặc được luyện tự do ngoài giờ.
//
// Đây cũng chính là bài học đã phải trả giá ở Giai đoạn 5a của chương trình Lớp:
// ĐỪNG ĐOÁN quyền sở hữu — hãy GHI nó. Bản khai này ghim đúng chỗ nó được ghi.
//
// BA ĐIỀU ĐƯỢC GHIM, mỗi cái một kiểu hỏng riêng:
//   · `class_item` phải có trong ĐƯỜNG DẪN của lệnh tạo lượt — mất là mất sổ.
//   · Mỗi đáp án là MỘT lần PATCH mang `q_num` đúng và `user_answer` là CHUỖI.
//     `q_num` ngoài 1..40 hoặc `user_answer` không phải chuỗi đều bị backend
//     từ chối (`TestAttemptAnswerPatchRequest` + chốt 1..40) — tức một bản port
//     gửi số thay vì chuỗi sẽ mất câu đó mà trang vẫn báo đã lưu.
//   · KHÔNG có lần PATCH nào SAU khi nộp. Backend từ chối (422 "đã submit"),
//     nên một lần ghi muộn là một câu bị mất trong im lặng.
//
// KHÔNG ghim thứ tự các lần PATCH ở đây. Trang có hàng đợi nối tiếp
// (`enqueuePatch`) để hai lần lưu không đè nhau, nhưng cổng này ghi nhận
// REQUEST chứ không ghi nhận lúc chúng kết thúc — nên nó không chứng minh được
// tính nối tiếp, và giả vờ chứng minh được là tự lừa mình. Việc đó thuộc về
// `PR #837/#838` phía máy chủ (một câu lệnh RPC nguyên tử).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FX = JSON.parse(readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/listening-test.json'), 'utf8'));

const TEST = FX.test_id;
const ITEM = FX.class_item;
const ATTEMPT = FX.attempt_id;

export default {
  name: 'listening-test — làm bài giao của lớp, giữ được class_item',
  route: '/listening/test',
  legacyRoute: `/pages/listening-test.html?id=${TEST}&class_item=${ITEM}`,
  nextPending: 'trang Next chưa tồn tại — bản khai dựng TRƯỚC khi port',
  settleMs: 900,
  drainMs: 1800,

  canned: [
    // Không có lượt làm dở: buộc trang đi đường TẠO MỚI (đường mang class_item),
    // chứ không phải đường TIẾP TỤC — đường tiếp tục cố ý KHÔNG đóng dấu lần
    // giao (`listening-test-player.js:280-286`), nên nếu bản khai vô tình rơi
    // vào đó thì nó chẳng kiểm được gì.
    // THỨ TỰ CÓ NGHĨA: bộ chạy lấy mẫu KHỚP ĐẦU TIÊN, nên mẫu rộng nhất
    // (chi tiết đề) phải đứng CUỐI, không thì nó nuốt cả các URL con.
    //
    // Và mọi mẫu phải chấp nhận CHUỖI TRUY VẤN. Bản đầu tôi viết `/\/attempts$/`
    // — trong khi URL thật là `…/attempts?class_item=…`, nên nó không khớp,
    // `res.attempt_id` thành `undefined`, và trang đi nộp bài tới
    // `…/attempts/undefined/submit`. Lượt chạy đầu tiên bắt đúng chuyện đó.
    [/\/attempts\/in-progress(\?|$)/, { attempt: null }],
    [/\/tests\/[^/?]+\/attempts(\?|$)/, { attempt_id: ATTEMPT }],
    [/\/answers(\?|$)/, {}],
    [/\/submit(\?|$)/, { score: 3, total: 3, correct: 3, band: 9 }],
    [/\/api\/listening\/tests\/[^/?]+(\?|$)/, FX.test],
  ],

  steps: [
    { wait: 900 },
    { click: '#btn-start' },
    { wait: 600 },
    // Gõ ba đáp án. `.ft-q-input[data-q-num]` là đúng phần tử người dùng gõ
    // (`listening-test-player.js:389`).
    { fill: ['.ft-q-input[data-q-num="1"]', FX.answers[0].user_answer] },
    { wait: 1400 },
    { fill: ['.ft-q-input[data-q-num="2"]', FX.answers[1].user_answer] },
    { wait: 1400 },
    { fill: ['.ft-q-input[data-q-num="3"]', FX.answers[2].user_answer] },
    { wait: 2000 },
    { click: "#btn-submit" },
    { wait: 600 },
  ],

  ignoreWrites: ['/api/analytics/events'],

  writes: [
    {
      method: 'POST',
      path: `/api/listening/tests/${TEST}/attempts`,
      times: 1,
      // PHẢI dùng `query`, KHÔNG được nhét `?class_item=` vào `path`.
      // `normalizePath` cắt bỏ chuỗi truy vấn, nên bản khai đầu tiên của tôi —
      // viết `path: '…/attempts?class_item=…'` — chạy XANH, rồi khi tôi bỏ hẳn
      // tham số đó khỏi URL nó VẪN XANH. Nó chưa từng kiểm điều nó tuyên bố;
      // chỉ đối chứng âm mới lộ ra. `query` là nguyên hàm thêm cùng PR này.
      query: { class_item: ITEM },
    },
    {
      method: 'PATCH',
      path: `/api/listening/tests/attempts/${ATTEMPT}/answers`,
      // SÀN, không phải con số chính xác — và lý do đáng nhớ: trang gắn CẢ
      // `input` LẪN `change` vào cùng hàm lưu (`listening-test-player.js:
      // 1189-1190`), nên số lần PATCH cho một câu phụ thuộc nhịp gõ. Đo được
      // trên chính trang legacy: chờ 300ms giữa các câu ⇒ 4 lần ghi, chờ
      // 1400ms ⇒ 6 lần, cho cùng ba đáp án. Ghim `times: 3` là ghim một con số
      // không có nghĩa; cổng sẽ chập chờn tới khi ai đó nới nó ra cho hết đỏ.
      //
      // Điều CÓ nghĩa: mọi đáp án đều tới nơi, đúng hình dạng. `bodyAll` vẫn
      // soi TOÀN BỘ tập, nên một lần ghi thừa mang thân sai vẫn đỏ.
      atLeast: 3,
      // Thứ tự tới nơi không được ghim (xem chú thích đầu tệp), nên soi CẢ TẬP.
      bodyAll: (bodies) => {
        const muốn = new Map(FX.answers.map((a) => [a.q_num, a.user_answer]));
        const đãTới = new Set();
        for (const b of bodies) {
          if (!b || !Number.isInteger(b.q_num)) return false;
          // Chốt 1..40 là của backend; gửi ngoài khoảng là 422 và mất câu đó.
          if (b.q_num < 1 || b.q_num > 40) return false;
          // PHẢI là chuỗi. Gửi số thì trang vẫn hiện "đã lưu" còn backend từ chối.
          if (typeof b.user_answer !== 'string') return false;
          // KHÔNG xoá khỏi `muốn` sau khi khớp: lần lưu thứ hai của cùng một câu
          // là hợp lệ (backend upsert theo `q_num`), và xoá đi sẽ làm chính lần
          // đó bị coi là sai — bản đầu của tôi mắc đúng lỗi này.
          if (muốn.get(b.q_num) !== b.user_answer) return false;
          đãTới.add(b.q_num);
        }
        // Mọi câu phải tới nơi. Thiếu một câu là mất một câu.
        return đãTới.size === muốn.size;
      },
    },
    {
      method: 'POST',
      path: `/api/listening/tests/attempts/${ATTEMPT}/submit`,
      times: 1,
    },
  ],
};
