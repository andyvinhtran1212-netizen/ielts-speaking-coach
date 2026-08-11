// Luồng ghi ĐẮT GIÁ NHẤT của cả sản phẩm: học viên THU ÂM câu trả lời rồi nộp
// để chấm.
//
// VÌ SAO NÓ QUAN TRỌNG HƠN CÁC LUỒNG KHÁC: mọi thứ khác học viên có thể gõ lại.
// Bản thu thì không — nó tồn tại đúng một lần, trong bộ nhớ trang, cho tới khi
// `POST /sessions/{id}/responses` nhận được. Hỏng khâu này là học viên nói xong
// một câu Part 2 hai phút rồi mất trắng, và trang vẫn có thể trông bình thường.
//
// HAI THỨ HARNESS PHẢI HỌC MỚI KIỂM ĐƯỢC (thêm trong cùng PR):
//   · THIẾT BỊ GIẢ của Chrome — để `getUserMedia` + `MediaRecorder` chạy THẬT và
//     sinh blob thật. Cách khác là chèn stub vào mã sản phẩm, nhưng thế thì bản
//     khai kiểm cái stub chứ không kiểm trang.
//   · TÁCH THÂN MULTIPART — bản thu đi bằng `FormData` (`practice.js:679-684`),
//     và chuỗi multipart thô thì không phép so nào đọc nổi. Trước PR này, đường
//     ghi đắt giá nhất là đường DUY NHẤT cổng không soi được.
//
// BA TRƯỜNG ĐƯỢC GHIM, mỗi trường một kiểu hỏng riêng:
//   · `question_id` — sai là câu trả lời gắn nhầm câu hỏi, điểm vẫn ra bình
//     thường nên không ai phát hiện;
//   · tên trường `audio_file` — phải khớp tham số File của backend
//     (`practice.js:681` ghi rõ "must match backend File param"); đổi tên là
//     backend nhận rỗng;
//   · KÍCH THƯỚC blob — phải khác 0, đo theo BYTE THẬT. Nói chính xác điều này
//     chứng minh: "có một tệp, đúng tên trường, không rỗng". Nó KHÔNG chứng minh
//     trong tệp có tiếng nói — một bản thu toàn im lặng vẫn có phần đầu container
//     nên vẫn khác 0. Khẳng định "có tiếng" cần giải mã âm thanh, nằm ngoài cổng
//     này; ghi ra đây để không ai đọc nhầm cái chốt đang bảo đảm gì.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SESSION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const QUESTION = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

export default {
  name: 'speaking — thu âm câu trả lời rồi nộp chấm',
  route: '/speaking/practice',
  legacyRoute: `/pages/practice.html?session_id=${SESSION}`,
  nextPending: 'trang Next chưa tồn tại — bản khai dựng TRƯỚC khi port',
  fakeMedia: true,
  settleMs: 2000,
  drainMs: 2500,

  canned: [
    // MẢNG TRẦN, không bọc `{questions: […]}`. Backend trả thẳng
    // `redact_questions(...)` là một list (`routers/questions.py:58`), và trang
    // gọi `questions.some(...)` — bọc sai là trang vào thẳng màn lỗi với
    // "questions.some is not a function", tức bản khai đỏ vì lý do SAI.
    [/\/sessions\/[^/]+\/questions$/, {
      __body: [{ id: QUESTION, question_text: 'Describe a place you like.', order_num: 1 }],
    }],
    [/\/sessions\/[^/]+$/, {
      id: SESSION, part: 1, status: 'in_progress',
      questions: [{ id: QUESTION, question_text: 'Describe a place you like.', order_num: 1 }],
      responses: [],
    }],
    // Hình dạng phản hồi chấm bài — trang đọc `overall_band` + `transcript` để
    // vẽ màn nhận xét; thiếu thì nó ném lỗi JS và luồng đỏ.
    [/\/responses$/, {
      // `response_id`, KHÔNG phải `id`. Một phản hồi 200 mà thiếu trường này
      // được trang hiểu là "chấm xong nhưng KHÔNG lưu được", và nó chuyển sang
      // màn báo-lỗi-thử-lại (`practice.js:714-725`). Dữ liệu giả sai tên trường
      // khiến bản khai vẫn xanh — vì nó chỉ soi request ĐI RA — trong khi trang
      // đang ở trạng thái hỏng (codex cục bộ #980).
      response_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      question_id: QUESTION,
      transcript: 'This is a test answer.',
      overall_band: 6.5,
      fluency_score: 6.5, lexical_score: 6.5, grammar_score: 6.5, pronunciation_score: 6.5,
      feedback: {}, grammar_issues: [], recommendations: [],
    }],
  ],

  steps: [
    { wait: 1500 },
    // Bấm Bắt đầu là thu âm chạy NGAY, không cần thêm cú bấm nào
    // (`practice.js:372`).
    { click: '#prep-start-btn' },
    // CHỜ THU BẮT ĐẦU rồi mới tính giờ. `getUserMedia` là bất đồng bộ và thiết
    // bị mất một lúc mới sẵn sàng; đếm 16 giây từ lúc BẤM thì máy CI chậm sẽ chỉ
    // thu được 14 giây, nút Nộp không mở, và luồng đỏ vì lý do SAI.
    { expectVisible: '#rec-recording' },
    // THU THẬT 16 GIÂY. Part 1 khoá nút Nộp tới khi đủ 15 giây
    // (`MIN_RECORD_SEC`, cố ý đồng bộ với `MIN_DURATION_BY_PART` phía backend),
    // và backend còn từ chối bản thu ngắn bằng 422 `audio_too_short`.
    //
    // KHÔNG tua đồng hồ được ở đây, dù harness có sẵn `fakeClock`: `MediaRecorder`
    // sinh dữ liệu theo thời gian THẬT, nên tua sẽ cho UI tưởng đã 15 giây trong
    // khi âm thanh chỉ dài 1 giây — ghim đúng một trạng thái production từ chối.
    // 16 giây thật là cái giá phải trả cho luồng đắt giá nhất bộ.
    { wait: 16000 },
    { click: 'button[onclick="PracticeApp.stopRecording()"]' },
    { wait: 600 },
    { click: '#rec-submit-btn' },
    { wait: 1200 },
    // Trang phải ĐẾN được màn nhận xét. Chỉ soi request đi ra thì một phản hồi
    // thiếu `response_id` (hoặc bất kỳ lỗi hậu-nộp nào) vẫn cho bản khai xanh.
    { expectVisible: '#state-feedback' },
  ],

  ignoreWrites: ['/api/analytics/events'],

  writes: [
    {
      method: 'POST',
      path: `/sessions/${SESSION}/responses`,
      body: (b) => b
        && b.question_id === QUESTION
        && b.audio_file
        && typeof b.audio_file === 'object'
        && b.audio_file.size > 0,
    },
  ],
};
