// Static content of /help (LEARNERCORE-0063 FR-062, sheet TroGiupLanDau
// screen 1): six fixed groups. Copy follows the sheet; every "XXX" of the
// sheet (numbers the owner has not given yet) is left out rather than guessed.
// `href` is a planned route: the page shows the link only while that route is
// live (`liveHref`), so no answer points at a 404.

/**
 * @typedef {{ id: string, q: string, a: string, link?: string, href?: string }} HelpItem
 * @typedef {{ id: string, name: string, items: readonly HelpItem[] }} HelpGroup
 */

/** @type {readonly HelpGroup[]} */
export const HELP_GROUPS = Object.freeze([
  {
    id: 'khoa-hoc',
    name: 'Khoá học và đăng ký',
    items: [
      {
        id: 'khoa-online-va-khoa-lop',
        q: 'Khoá online và khoá của lớp khác nhau thế nào?',
        a: 'Khoá online bạn đăng ký trên web: AI chấm và trả nhận xét ngay; mỗi khoá có học phí, thời hạn và lượt chấm AI riêng. Khoá của lớp dành cho học viên lớp offline, mở bằng mã admin cấp kèm số lượt chấm AI. Bài của lớp dùng lượt lớp cấp cho bạn; Writing được AI chấm, giáo viên duyệt rồi mới trả, Speaking AI chấm và trả ngay.',
      },
      {
        id: 'dang-ky-khoa-online',
        q: 'Đăng ký khoá online thế nào?',
        a: 'Chọn khoá, tạo đơn đăng ký, chuyển khoản học phí bằng VietQR với nội dung là mã đơn. Admin đối chiếu rồi mở khoá cho bạn; bạn nhận email khi khoá mở.',
        link: 'Xem các khoá',
        href: '/courses',
      },
      {
        id: 'da-chuyen-khoan-chua-mo',
        q: 'Đã chuyển khoản mà khoá chưa mở?',
        a: 'Mở “Đơn đăng ký của tôi” để xem đơn đang ở bước nào. Chuyển sai số tiền hoặc sai nội dung thì đơn chuyển sang “Cần bổ sung” kèm hướng dẫn.',
        link: 'Đơn đăng ký của tôi',
        href: '/account/orders',
      },
    ],
  },
  {
    id: 'luot-cham',
    name: 'Lượt chấm AI',
    items: [
      {
        id: 'mot-luot-la-gi',
        q: 'Một lượt chấm AI là gì?',
        a: '1 lượt = 1 bài Writing, hoặc 1 bài Speaking Part 2, hoặc 1 cụm Part 1 gồm 2–3 câu (Part 3 tính như Part 1); Writing và Speaking dùng chung một kho lượt. Bài của lớp dùng lượt lớp cấp cho bạn kèm mã. Luyện Listening, Reading, từ vựng, ngữ pháp không tính lượt.',
      },
      {
        id: 'cham-loi-mat-luot',
        q: 'Chấm lỗi có mất lượt không?',
        a: 'Không. Nếu hệ thống chấm lỗi, lượt được hoàn tự động và hiện thành dòng “Hoàn lượt” trong lịch sử lượt.',
        link: 'Xem lịch sử lượt',
        href: '/account',
      },
      {
        id: 'het-luot',
        q: 'Hết lượt thì sao?',
        a: 'Bạn vẫn học bài giảng và luyện các phần không tính lượt. Lượt của khoá online đi kèm khoá và có hạn dùng; không đăng ký lại thì số lượt còn lại hết hiệu lực khi khoá hết hạn. Học viên lớp offline: liên hệ giáo viên để được cấp thêm.',
      },
    ],
  },
  {
    id: 'lam-bai',
    name: 'Làm bài và nộp bài',
    items: [
      {
        id: 'tu-luu-bai',
        q: 'Bài đang viết có tự lưu không?',
        a: 'Có. Bài Writing tự lưu nháp khi bạn gõ.',
      },
      {
        id: 'nop-nham',
        q: 'Nộp nhầm bài thì sao?',
        a: 'Bài đã nộp không sửa được. Với khoá online, bạn làm lại bài từ phiếu kết quả (dùng thêm 1 lượt). Với bài được giao của lớp, báo giáo viên lớp.',
      },
      {
        id: 'thi-thu',
        q: 'Thi thử gồm những gì?',
        a: 'Đề bạn tự chọn có full test từng kỹ năng và mini test: làm lúc nào cũng được, làm lại được. Mock test nhiều kỹ năng chỉ có khi giáo viên hoặc admin giao; mỗi phần làm một lần. Overall band chỉ có ở mock test được giao.',
        link: 'Mở Thi thử',
        href: '/tests',
      },
    ],
  },
  {
    id: 'ket-qua',
    name: 'Kết quả và chấm lại',
    items: [
      {
        id: 'band-co-phai-diem-that',
        q: 'Band trên phiếu nhận xét có phải điểm thi thật không?',
        a: 'Không. Đó là band ước lượng từ bài luyện để bạn biết nên sửa gì trước.',
      },
      {
        id: 'bai-lop-chua-co-diem',
        q: 'Vì sao bài của lớp chưa có điểm?',
        a: 'Bài Writing của lớp offline được AI chấm rồi giáo viên duyệt mới trả. Trong lúc đó phiếu ghi “Chờ giáo viên duyệt” và không hiện điểm. Bài Speaking của lớp được AI chấm và trả ngay.',
      },
      {
        id: 'yeu-cau-cham-lai',
        q: 'Gửi yêu cầu chấm lại thế nào?',
        a: 'Trên phiếu kết quả, chọn “Yêu cầu chấm lại”, chọn lý do và ghi chú thêm nếu cần. Bạn nhận kết quả xem xét qua email và trên phiếu.',
      },
    ],
  },
  {
    id: 'tai-khoan',
    name: 'Tài khoản',
    items: [
      {
        id: 'bi-dang-xuat',
        q: 'Vì sao tôi bị đăng xuất?',
        a: 'Mỗi tài khoản học viên chỉ dùng trên một thiết bị tại một thời điểm. Khi đăng nhập ở thiết bị mới, bạn được hỏi trước; chọn “Tiếp tục ở đây” thì thiết bị cũ đăng xuất. Nếu thiết bị cũ đang làm bài có giờ, thiết bị mới phải chờ bài kết thúc; bạn không bị đẩy ra giữa bài.',
      },
      {
        id: 'nhap-ma-kich-hoat',
        q: 'Nhập mã kích hoạt của lớp ở đâu?',
        a: 'Menu tài khoản → Khoá học và lượt AI → “Nhập mã kích hoạt của lớp”. Mã do admin cấp, chỉ mở khoá của lớp, không mở khoá online.',
        link: 'Khoá học và lượt AI',
        href: '/account',
      },
      {
        id: 'doi-email',
        q: 'Đổi email đăng nhập được không?',
        a: 'Được. Ở trang Hồ sơ, chọn “Đổi email đăng nhập”, nhập mã 6 số gửi tới email mới; đổi xong có thư báo về email cũ.',
        link: 'Mở Hồ sơ',
        href: '/profile',
      },
    ],
  },
  {
    id: 'ky-thuat',
    name: 'Kỹ thuật: micro, âm thanh',
    items: [
      {
        id: 'khong-nhan-micro',
        q: 'Trình duyệt không nhận micro',
        a: 'Bấm biểu tượng ổ khoá cạnh thanh địa chỉ, cho phép micro rồi tải lại trang. Dùng Chrome, Edge hoặc Safari bản mới; đóng ứng dụng khác đang dùng micro như Zoom, Meet.',
      },
      {
        id: 'khong-nghe-listening',
        q: 'Không nghe được âm thanh bài Listening',
        a: 'Kiểm tra âm lượng máy và tai nghe, rồi tải lại trang. Mạng chậm thì chờ thanh tải đầy rồi mới bấm phát.',
      },
      {
        id: 'ghi-am-re',
        q: 'Ghi âm Speaking bị rè hoặc quá nhỏ',
        a: 'Để micro cách miệng khoảng một gang tay, tránh quạt và chỗ ồn. Thử ghi một câu ngắn rồi nghe lại trước khi vào bài.',
      },
    ],
  },
]);
