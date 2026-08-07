// Cùng lưới an toàn, ĐƯỜNG HỎNG: máy chủ từ chối lần trả nợ.
//
// Hai bản khai kia đều chạy đường LÀNH (máy chủ nhận) hoặc đường bỏ-qua (nợ của
// người khác). Không cái nào kiểm điều quan trọng nhất: khi máy chủ hỏng, món nợ
// phải Ở LẠI. Xoá nhầm ở nhánh này là mất vĩnh viễn — lượt thi không bao giờ có
// điểm Speaking, và không còn dấu vết nào để lần sau thử lại.
//
// Đây đúng kiểu lỗi mà một lần "dọn dẹp cho gọn" dễ gây ra: gộp `clear()` ra
// ngoài `then()` là mọi lần gửi đều xoá nợ, kể cả lần thất bại.
import base from './speaking-debt-retry.mjs';

const KEY = 'mock-speaking-owed';

export default {
  ...base,
  name: 'speaking — máy chủ từ chối thì nợ phải Ở LẠI',
  // Chuỗi thử lại giãn 1s + 3s + 8s (`RETRY_DELAYS`), nên phải chờ hết 12 giây
  // mới thấy đủ. Để cửa sổ ngắn hơn thì chỉ đếm được 3 lần — và ghim con số 3 là
  // ghim một sản phẩm phụ của cấu hình test chứ không phải hợp đồng của trang.
  drainMs: 3000,

  canned: [
    ...base.canned.filter(([re]) => !/speaking\$/.test(String(re))),
    // 500 chứ không phải 200: dựng đúng cảnh máy chủ hỏng.
    [/\/speaking$/, { __status: 500, __body: { detail: 'lỗi máy chủ giả lập' } }],
  ],

  steps: [
    // CHỜ HẾT chuỗi thử lại (1s + 3s + 8s) TRƯỚC khi soi kho. Bước chạy trước
    // `drainMs`, nên soi ở giây thứ 2 là soi lúc lần gửi cuối còn chưa xảy ra —
    // một bản mã xoá nợ SAU lần hỏng cuối cùng vẫn qua (codex cục bộ #982).
    { wait: 15000 },
    // Nợ phải còn NGUYÊN. Bản khai chị em ghim chiều ngược (trả xong thì xoá),
    // nên hai cái cộng lại ghim đúng một câu: xoá KHI VÀ CHỈ KHI máy chủ nhận.
    { expectStorage: [KEY, base.initStorage[KEY]] },
  ],

  writes: [
    {
      ...base.writes[0],
      // 1 lần đầu + 3 lần thử lại (`RETRY_DELAYS` có 3 mốc). Ghim CON SỐ chứ
      // không để lỏng: bỏ mất cơ chế thử lại là một trục trặc mạng chớp nhoáng
      // biến thành mất điểm, mà cả ba request đều giống hệt nhau nên không phép
      // so thân nào thấy.
      times: 4,
    },
  ],
};
