// Bài tập ngữ pháp theo buổi: làm nốt CHẶNG CUỐI rồi xét đạt.
//
// VÌ SAO GHIM: `POST /api/quiz/course/verdict` ghi kết luận THẲNG vào
// `class_assignment_items` (passed_at + sổ mastery) — giáo viên đọc đúng một
// cột. Backend CỐ Ý không nhận tổng điểm do client khai; client chỉ NÊU TÊN các
// phiên của lượt vừa làm rồi server tự cộng từ dòng nó giữ
// (`quiz_service.py:1941-1948`).
//
// Hệ quả: `session_ids` LÀ toàn bộ hợp đồng. Gửi thiếu một phiên là chấm thiếu
// một chặng, và sổ ghi sai — mà sổ bài tập theo buổi hỏng thì kẹt vĩnh viễn
// (sự cố đã xảy ra thật, xem `docs` + ghi chú trong `quiz_service`).
//
// ĐIỀU ĐƯỢC GHIM, và vì sao nó không hiển nhiên:
//
//   `runSessions` KHÔNG chỉ gồm phiên vừa mở trong tab này. Nó được seed từ
//   `completed` mà SERVER trả về ở `GET /banks/{id}/course-resume` — đúng danh
//   sách các phiên chặng đã chốt, kể cả những chặng học viên làm ở MÁY KHÁC hôm
//   trước (`course-runner.js:257`). Một bản port đọc thiếu `completed`, hoặc chỉ
//   gửi phiên của tab hiện tại, vẫn chạy trơn tru và vẫn ra một kết luận —
//   nhưng là kết luận dựa trên MỘT chặng thay vì hai. Không màn hình nào tố cáo.
//
// DỰNG LƯỢT RÚT GỌN, không chơi đủ 100 câu: đề trong dữ liệu giả có 20 câu = 2
// chặng, và `course-resume` khai chặng 1 ĐÃ chốt. Học viên chỉ còn chặng cuối,
// nhưng `session_ids` vẫn phải mang CẢ HAI. Đây là cách kiểm đúng tính chất mà
// không cần một bản khai dài 100 bước — bản khai dài thì giòn, và giòn thì bị
// nới cho hết đỏ.
//
// KHÔNG có `legacyRoute`: trang này chỉ tồn tại ở bản Next (không có
// `pages/course-*.html`). Cùng khuôn với 11 luồng hiện có — bộ chạy bỏ qua
// chúng ở vế legacy và nói rõ ra.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FX = JSON.parse(readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/course-exercises.json'), 'utf8'));

const BANK = FX.bank_id;
const S1 = FX.session_stage1;
const SNEW = FX.session_new;
const STAGE = FX.stage_size;

// Một câu = bấm một phương án rồi bấm tiếp. Sinh bằng vòng lặp thay vì chép tay:
// chép 10 khối giống nhau là mời gọi sai lệch giữa các khối.
const trảLời = [];
for (let i = 0; i < STAGE; i += 1) {
  trảLời.push({ click: '.cx-opt[data-i="0"]' });
  trảLời.push({ wait: 220 });
  // `#cx-next` chỉ là KHUNG CHỨA; nút bấm thật là `#cx-go` («Câu tiếp»),
  // do trang dựng sau khi đã chọn (`course-behavior.tsx:181-182`).
  trảLời.push({ click: '#cx-go' });
  trảLời.push({ wait: 220 });
}

export default {
  name: 'course-exercises — xét đạt phải gom ĐỦ phiên các chặng',
  route: `/course-exercises?bank=${BANK}`,
  settleMs: 1000,
  drainMs: 2000,

  canned: [
    // Chặng 1 đã chốt ở lượt trước — server nhớ hộ, không phải localStorage.
    [/\/course-resume/, FX.resume],
    [/\/api\/quiz\/banks\/[^/?]+(\?|$)/, { bank: FX.bank, questions: FX.questions, mastery: FX.mastery }],
    // HÌNH DẠNG THẬT của `start_session()`: `{session_id, resume}` — KHÔNG phải
    // `{id}`. Bộ chạy đọc `s.id || s.session_id` nên cả hai đều chạy, nhưng dữ
    // liệu sẵn sai hình dạng sẽ cho một bản port chỉ đọc `id` qua cổng rồi
    // KHÔNG nhận được mã phiên trên production — mất luôn cả đẩy bài, chốt
    // chặng lẫn xét đạt (bot bắt ở #1012).
    [/\/api\/quiz\/sessions$/, { session_id: SNEW, resume: null }],
    [/\/api\/quiz\/sessions\/[^/?]+(\?|$)/, {}],
    [/\/progress$/, {}],
    [/\/course\/verdict$/, { passed: true, score: 0.9, threshold: 0.8 }],
  ],

  steps: [
    { wait: 1000 },
    { expectVisible: '.cx-opt' },
    ...trảLời,
    { wait: 1200 },
  ],

  ignoreWrites: ['/api/analytics/events'],

  writes: [
    // Mở phiên cho CHẶNG CUỐI. `kind` chỉ khai ở lượt kiểm-tra-lại
    // (`course-runner.js:325`), nên lượt chính phải VẮNG nó — gửi thừa là bản
    // ghi rơi vào nhánh khác.
    {
      method: 'POST',
      path: '/api/quiz/sessions',
      times: 1,
      body: (b) => b && b.bank_id === BANK && b.kind === undefined,
    },
    // Đẩy bài làm. SỐ LẦN là tạo tác của nhịp gom lô (`flush()` chạy nền), nên
    // dùng SÀN chứ không ghim con số — ghim thì cổng chập chờn theo tốc độ máy.
    // Điều CÓ nghĩa: mọi lượt trả lời đều thuộc CHẶNG ĐANG LÀM và đủ hình dạng
    // mà `ProgressBody`/`log_progress` chờ đợi.
    {
      method: 'POST',
      path: `/api/quiz/sessions/${SNEW}/progress`,
      atLeast: 1,
      bodyAll: (bodies) => {
        const hết = bodies.flatMap((b) => (b && Array.isArray(b.attempts)) ? b.attempts : []);
        if (hết.length !== STAGE) return false;              // đủ 10 câu của chặng
        // Chặng 2 = câu thứ 11..20 của đề. Gửi nhầm câu chặng 1 nghĩa là ghi đè
        // lượt làm cũ bằng lượt mới — mất dữ liệu, không báo lỗi.
        const chặngCuối = FX.questions.slice(STAGE);
        const đápÁnGốc = new Map(chặngCuối.map((q) => [q.qid, q.answer]));
        const sốLựa = new Map(chặngCuối.map((q) => [q.qid, q.options.length]));
        const đãThấy = new Set();
        for (const a of hết) {
          if (!a || !đápÁnGốc.has(a.qid)) return false;
          // ĐÚNG MỘT LẦN mỗi câu. Đếm tổng + kiểm thuộc-tập là CHƯA đủ: gửi một
          // qid hợp lệ mười lần vẫn qua, trong khi server gộp trùng theo qid
          // (`quiz_service.py:2059-2078`) nên chỉ tính là 1 câu ⇒ verdict thật
          // rớt vì thiếu cỡ mẫu, còn cổng thì xanh (bot bắt ở #1012).
          if (đãThấy.has(a.qid)) return false;
          đãThấy.add(a.qid);
          if (typeof a.is_correct !== 'boolean') return false;
          if (!Number.isInteger(a.response_time_ms) || a.response_time_ms < 0) return false;
          if (!a.client_id || !a.item_key) return false;
          // `answer_given` là thứ server THẬT SỰ chấm; nó CỐ Ý bỏ qua `is_correct`
          // vì đó chỉ là lời client (`quiz_service.py:2035-2039`). Bản khai không
          // soi trường này thì một bản port gửi `answer_given` hỏng kèm
          // `is_correct` nghe hợp lý vẫn qua cổng mà sai kết luận trên production.
          //
          // Gửi VỊ TRÍ GỐC dạng chuỗi (`course-runner.js:443-445`).
          const n = Number(a.answer_given);
          if (typeof a.answer_given !== 'string') return false;
          if (!Number.isInteger(n) || n < 0 || n >= sốLựa.get(a.qid)) return false;
          // Và hai lời khai phải NHẤT QUÁN với nhau theo đúng phép server dùng.
          if (a.is_correct !== (n === đápÁnGốc.get(a.qid))) return false;
        }
        // Phủ HẾT chặng, không thiếu câu nào.
        if (đãThấy.size !== chặngCuối.length) return false;
        // `word_stats` là ô của luồng từ vựng; bài theo buổi phải để rỗng.
        return bodies.every((b) => Array.isArray(b.word_stats) && b.word_stats.length === 0);
      },
    },
    // CHỐT chặng. Chỉ phiên đã chốt mới được nêu tên ở lượt xét đạt
    // (`course-runner.js:501-505`), nên thiếu lệnh này là mất luôn chặng.
    {
      method: 'PATCH',
      path: `/api/quiz/sessions/${SNEW}`,
      times: 1,
      body: (b) => b && b.total_questions === STAGE
        && Number.isInteger(b.total_correct) && Number.isInteger(b.total_wrong)
        && b.total_correct + b.total_wrong === STAGE
        && b.ended_by === 'completed'
        && Number.isInteger(b.duration_sec) && b.duration_sec >= 0,
    },
    // Xét đạt. ĐÂY là điều luồng này sinh ra để bảo vệ.
    {
      method: 'POST',
      path: '/api/quiz/course/verdict',
      times: 1,
      body: (b) => {
        if (!b || b.bank_id !== BANK) return false;
        if (!Array.isArray(b.session_ids)) return false;
        // ĐÚNG hai phiên: chặng trước (server trả qua `completed`) và chặng vừa
        // làm. Thiếu phiên đầu = chấm thiếu một chặng; thiếu phiên sau = chấm
        // thiếu chính chặng vừa xong.
        return b.session_ids.length === 2
          && b.session_ids.includes(S1)
          && b.session_ids.includes(SNEW);
      },
    },
  ],
};
