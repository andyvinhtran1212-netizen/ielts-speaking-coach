// G02-T13 — khung tạm cho bốn trang công khai Điều khoản, Quyền riêng tư,
// Liên hệ, Giới thiệu; G03-T13 chuyển chúng sang cây "Bản in" `(public-v2)`.
// Tên các điều và câu "mục này nói về…" lấy theo tờ thiết kế `thiet-ke/PhapLy.dc.html`. Mọi thân bài, ngày tháng và thông tin
// liên hệ còn là XXX: đây KHÔNG phải nội dung pháp lý; toàn bộ phải qua rà
// soát pháp lý trước khi bỏ `noindex`.

export type LegalClause = { n: string; title: string; body?: string };
export type LegalArticle = { title: string; about: string; clauses: LegalClause[] };
export type LegalDocument = { title: string; articles: LegalArticle[] };

export const PLACEHOLDER = 'XXX';

export const TERMS: LegalDocument = {
  title: 'Điều khoản sử dụng',
  articles: [
    {
      title: 'Tài khoản',
      about: 'Mục này nói về việc tạo tài khoản, thông tin bạn cung cấp và việc giữ an toàn thông tin đăng nhập.',
      clauses: [
        { n: '1.1', title: 'Tạo tài khoản, cách đăng nhập và thông tin bạn cung cấp' },
        { n: '1.2', title: 'Bảo mật tài khoản' },
      ],
    },
    {
      title: 'Đăng ký khoá và thời hạn truy cập',
      about: 'Mục này nói về học phí khoá online, thanh toán chuyển khoản, việc xác nhận và mở khoá, thời hạn truy cập, và khoá của lớp offline mở bằng mã kích hoạt.',
      clauses: [
        { n: '2.1', title: 'Học phí và thanh toán chuyển khoản' },
        { n: '2.2', title: 'Xác nhận và mở khoá' },
        { n: '2.3', title: 'Thời hạn truy cập' },
        { n: '2.4', title: 'Khoá của lớp offline và mã kích hoạt do admin cấp' },
      ],
    },
    {
      title: 'Lượt chấm AI',
      about: 'Mục này nói về số lượt chấm đi kèm khoá online, giới hạn của việc chấm bằng AI, và cách chấm bài của học viên lớp offline.',
      clauses: [
        { n: '3.1', title: 'Số lượt đi kèm mỗi khoá online', body: 'Số lượt: XXX. Writing và Speaking dùng chung một kho lượt. Lượt có hạn dùng (XXX); đăng ký lại thì toàn bộ lượt chưa dùng được chuyển sang, bảo lưu tối đa 2 tháng; không thì hết hiệu lực khi khoá hết hạn.' },
        { n: '3.2', title: 'Giới hạn của chấm AI', body: 'XXX. Điểm phát âm chỉ được chấm trên một đoạn trích của bài nói; các tiêu chí khác chấm trên toàn bộ bài.' },
        { n: '3.3', title: 'Bài của học viên lớp offline', body: 'Admin cấp số lượt chấm kèm mã kích hoạt; bài của lớp dùng lượt này, hết lượt thì liên hệ giáo viên để được cấp thêm. Writing: AI chấm, giáo viên duyệt rồi mới trả. Speaking: AI chấm, trả ngay.' },
      ],
    },
    {
      title: 'Hoàn tiền (XXX)',
      about: 'Mục này nói về các trường hợp và cách yêu cầu hoàn tiền. Chính sách chưa chốt.',
      clauses: [
        { n: '4.1', title: 'Điều kiện hoàn tiền' },
        { n: '4.2', title: 'Cách yêu cầu và thời gian xử lý' },
      ],
    },
    {
      title: 'Một tài khoản, một người dùng',
      about: 'Mục này nói về việc không chia sẻ tài khoản và hậu quả khi vi phạm.',
      clauses: [
        { n: '5.1', title: 'Quy định sử dụng cá nhân', body: 'Mỗi tài khoản học viên dùng ở một thiết bị một lúc. Đăng nhập ở thiết bị mới sẽ hỏi trước khi đăng xuất thiết bị kia; đang làm bài có giờ thì không bị đẩy ra. XXX' },
        { n: '5.2', title: 'Khi phát hiện dùng chung' },
      ],
    },
    {
      title: 'Nội dung và bản quyền',
      about: 'Mục này nói về quyền sử dụng bài giảng và quyền đối với bài bạn nộp.',
      clauses: [
        { n: '6.1', title: 'Bài giảng và tài liệu của Aver Learning' },
        { n: '6.2', title: 'Bài viết và bản ghi âm do bạn nộp' },
      ],
    },
    {
      title: 'Chấm dứt',
      about: 'Mục này nói về việc bạn hoặc Aver Learning chấm dứt tài khoản và điều gì xảy ra sau đó.',
      clauses: [
        { n: '7.1', title: 'Bạn chấm dứt' },
        { n: '7.2', title: 'Aver Learning chấm dứt' },
      ],
    },
  ],
};

export const PRIVACY: LegalDocument = {
  title: 'Chính sách quyền riêng tư',
  articles: [
    {
      title: 'Dữ liệu chúng tôi thu thập',
      about: 'Mục này nói về những dữ liệu cá nhân được thu thập khi bạn dùng Aver Learning.',
      clauses: [
        { n: '1.1', title: 'Thông tin tài khoản' },
        { n: '1.2', title: 'Bản ghi âm giọng nói', body: 'Chỉ khi bạn ghi âm bài Speaking. Dùng để chấm và trả nhận xét; giữ tối đa 60 ngày.' },
        { n: '1.3', title: 'Bài viết bạn nộp' },
        { n: '1.4', title: 'Dữ liệu sử dụng' },
      ],
    },
    {
      title: 'Mục đích sử dụng',
      about: 'Mục này nói về lý do từng loại dữ liệu được xử lý.',
      clauses: [
        { n: '2.1', title: 'Cung cấp khoá học và chấm bài' },
        { n: '2.2', title: 'Liên hệ và hỗ trợ' },
      ],
    },
    {
      title: 'Bên xử lý dữ liệu (dịch vụ AI) XXX',
      about: 'Mục này nói về các bên xử lý dữ liệu thay mặt Aver Learning, gồm dịch vụ AI chấm bài.',
      clauses: [
        { n: '3.1', title: 'Dịch vụ AI nhận những dữ liệu nào' },
        { n: '3.2', title: 'Các bên xử lý khác' },
      ],
    },
    {
      title: 'Thời gian lưu giữ (một phần chưa chốt)',
      about: 'Mục này nói về thời gian lưu từng loại dữ liệu và khi nào dữ liệu bị xoá.',
      clauses: [
        { n: '4.1', title: 'Bài viết và bản ghi âm', body: 'Bản ghi âm Speaking giữ tối đa 60 ngày kể từ lúc nộp rồi xoá. Bài làm: giữ 45 ngày sau khi khoá hết hạn.' },
        { n: '4.2', title: 'Thông tin tài khoản' },
      ],
    },
    {
      title: 'Quyền của bạn',
      about: 'Mục này nói về các quyền của bạn đối với dữ liệu cá nhân và cách thực hiện.',
      clauses: [
        { n: '5.1', title: 'Xem dữ liệu của bạn' },
        { n: '5.2', title: 'Sửa dữ liệu' },
        { n: '5.3', title: 'Xoá dữ liệu' },
        { n: '5.4', title: 'Rút lại đồng ý' },
      ],
    },
    {
      title: 'Liên hệ',
      about: 'Mục này nói về nơi gửi yêu cầu liên quan đến dữ liệu cá nhân.',
      clauses: [{ n: '6.1', title: 'Đầu mối tiếp nhận yêu cầu' }],
    },
  ],
};

/** Khối kênh liên hệ dùng chung (tờ PhapLy mục 2; sau này cả TroGiupLanDau). */
export const CONTACT_CHANNELS = [
  { label: 'Email', value: PLACEHOLDER },
  { label: 'Điện thoại', value: PLACEHOLDER },
  { label: 'Zalo', value: PLACEHOLDER },
  { label: 'Giờ trả lời', value: PLACEHOLDER },
] as const;

export const LEGAL_ROBOTS = { index: false, follow: true } as const;
