// UIBASE-0056 icon set (FR-006), built by G11-T32 (GOI-11 5.7.3, FR-11-113).
// Every name and drawing below is copied from the `iconGroups` array of
// docs/proposals/commercialization-2026-11/thiet-ke/ThanhPhanNenTang.dc.html,
// in the sheet's group order: 94 icons in 9 groups. The sheet's c(x, y, r)
// helper is stored as a circle. 24 grid, 2px stroke, round caps and joins,
// currentColor; nothing is filled except the dot of `record` (the sheet's only
// exception). New icons follow the sheet's rule: a 24 grid, a 2px stroke, a
// lower-case hyphenated name, in the right group.
//
// `fills` are drawn filled with currentColor.
export type IconShape = {
  paths: readonly string[];
  circles?: readonly (readonly [number, number, number])[];
  fills?: readonly string[];
};

/** The 94 icons of ThanhPhanNenTang §5, grouped as on the sheet. */
export const SHEET_ICONS = {
  // Điều hướng và chỉ hướng (13)
  menu: { paths: ['M4 7h16M4 12h16M4 17h16'] },
  'chev-down': { paths: ['M6 9l6 6 6-6'] },
  'chev-up': { paths: ['M6 15l6-6 6 6'] },
  'chev-left': { paths: ['M15 6l-6 6 6 6'] },
  'chev-right': { paths: ['M9 6l6 6-6 6'] },
  'arrow-left': { paths: ['M19 12H5M11 6l-6 6 6 6'] },
  'arrow-right': { paths: ['M5 12h14M13 6l6 6-6 6'] },
  'arrow-up': { paths: ['M12 19V5M6 11l6-6 6 6'] },
  'arrow-down': { paths: ['M12 5v14M6 13l6 6 6-6'] },
  external: { paths: ['M14 4h6v6M20 4l-9 9M18 14v6H4V6h6'] },
  close: { paths: ['M6 6l12 12M18 6L6 18'] },
  more: { paths: [], circles: [[5, 12, 1], [12, 12, 1], [19, 12, 1]] },
  drag: { paths: [], circles: [[9, 6, 1], [15, 6, 1], [9, 12, 1], [15, 12, 1], [9, 18, 1], [15, 18, 1]] },
  // Thao tác với nội dung (15)
  plus: { paths: ['M12 5v14M5 12h14'] },
  minus: { paths: ['M5 12h14'] },
  trash: { paths: ['M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6'] },
  copy: { paths: ['M9 9h11v11H9zM5 15H4V4h11v1'] },
  save: { paths: ['M4 4h13l3 3v13H4zM8 4v5h8V4M8 20v-6h8v6'] },
  download: { paths: ['M12 4v11M7 10l5 5 5-5M4 15v5h16v-5'] },
  upload: { paths: ['M12 15V4M7 9l5-5 5 5M4 15v5h16v-5'] },
  print: { paths: ['M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z'] },
  link: { paths: ['M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'] },
  refresh: { paths: ['M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5'] },
  highlight: { paths: ['M9 14l6-6 3 3-6 6H9zM15 8l2-2 3 3-2 2M4 21h8'] },
  note: { paths: ['M4 4h16v12l-4 4H4zM16 20v-4h4M8 9h8M8 13h4'] },
  bookmark: { paths: ['M6 3h12v18l-6-4-6 4z'] },
  flag: { paths: ['M5 21V4M5 4h11l-2 4 2 4H5'] },
  star: { paths: ['M12 3l2.7 5.6 6.3.9-4.5 4.4 1 6.1L12 17l-5.5 3 1-6.1L3 9.5l6.3-.9z'] },
  // Phát nghe và ghi âm (14)
  play: { paths: ['M7 4l13 8-13 8z'] },
  pause: { paths: ['M8 5v14M16 5v14'] },
  stop: { paths: ['M6 6h12v12H6z'] },
  'back-10': { paths: ['M3 12a9 9 0 1 0 3-6.7M3 4v5h5'] },
  'fwd-10': { paths: ['M21 12a9 9 0 1 1-3-6.7M21 4v5h-5'] },
  repeat: { paths: ['M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3'] },
  speed: { paths: ['M3.5 17a9 9 0 1 1 17 0M12 14l4-5'] },
  volume: { paths: ['M4 9v6h4l5 4V5L8 9zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11'] },
  'volume-off': { paths: ['M4 9v6h4l5 4V5L8 9zM17 9l5 6M22 9l-5 6'] },
  mic: { paths: ['M9 3h6v11H9zM5 11a7 7 0 0 0 14 0M12 18v3'] },
  record: { paths: [], circles: [[12, 12, 4]], fills: ['M10 12a2 2 0 1 0 4 0a2 2 0 1 0 -4 0'] },
  subtitles: { paths: ['M3 6h18v12H3zM10 10.5a2 2 0 1 0 0 3M17 10.5a2 2 0 1 0 0 3'] },
  video: { paths: ['M3 5h18v14H3zM10 9v6l5-3z'] },
  headphones: { paths: ['M4 15v-3a8 8 0 0 1 16 0v3M4 15h4v5H4zM16 15h4v5h-4z'] },
  // Nội dung và tệp (13)
  file: { paths: ['M6 3h8l4 4v14H6zM14 3v4h4'] },
  book: { paths: ['M12 6C10 4.5 7 4 3 4v15c4 0 7 .5 9 2 2-1.5 5-2 9-2V4c-4 0-7 .5-9 2zM12 6v15'] },
  image: { paths: ['M3 4h18v16H3zM3 16l5-5 5 5M13 14l3-3 5 5'], circles: [[8, 8, 1.5]] },
  folder: { paths: ['M3 5h6l2 2h10v13H3z'] },
  clipboard: { paths: ['M8 4h8v3H8zM6 5.5V21h12V5.5M9 12h6M9 16h4'] },
  flashcard: { paths: ['M7 7h13v13H7zM4 16V4h12'] },
  chart: { paths: ['M4 4v16h16M8 17v-5M12 17V8M17 17v-3'] },
  trend: { paths: ['M3 17l6-6 4 4 8-8M15 7h6v6'] },
  target: { paths: [], circles: [[12, 12, 9], [12, 12, 5], [12, 12, 1]] },
  lightbulb: { paths: ['M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z'] },
  sparkle: { paths: ['M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z'] },
  qr: { paths: ['M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3M21 14v1M14 20v1M18 21h3v-3'] },
  'credit-card': { paths: ['M3 5h18v14H3zM3 10h18M7 15h4'] },
  // Trạng thái và cảnh báo (12)
  check: { paths: ['M5 12l5 5 9-10'] },
  'check-circle': { paths: ['M7.5 12.5l3 3 6-7'], circles: [[12, 12, 9]] },
  'x-circle': { paths: ['M9 9l6 6M15 9l-6 6'], circles: [[12, 12, 9]] },
  warning: { paths: ['M12 3L2 20h20zM12 10v4.5M12 17v.5'] },
  error: { paths: ['M12 7.5v5.5M12 16v.5'], circles: [[12, 12, 9]] },
  info: { paths: ['M12 11v5M12 7.5v.5'], circles: [[12, 12, 9]] },
  help: { paths: ['M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7M12 17v.5'], circles: [[12, 12, 9]] },
  circle: { paths: [], circles: [[12, 12, 9]] },
  partial: { paths: ['M12 3a9 9 0 0 1 0 18z'], circles: [[12, 12, 9]] },
  offline: { paths: ['M3 9a14 14 0 0 1 18 0M6 12.5a9.5 9.5 0 0 1 12 0M9 16a5 5 0 0 1 6 0M12 19.5h.01M4 4l16 16'] },
  inbox: { paths: ['M3 13l3-8h12l3 8v6H3zM3 13h5l1 3h6l1-3h5'] },
  checkbox: { paths: ['M3 3h18v18H3zM7 12l3.5 3.5L17 8'] },
  // Tìm, lọc, xem (9)
  search: { paths: ['M16.5 16.5L21 21'], circles: [[11, 11, 7]] },
  filter: { paths: ['M4 6h16M7 12h10M10 18h4'] },
  sort: { paths: ['M8 5v14M4 9l4-4 4 4M16 19V5M12 15l4 4 4-4'] },
  'zoom-in': { paths: ['M15.5 15.5L21 21M7.5 10.5h6M10.5 7.5v6'], circles: [[10.5, 10.5, 6.5]] },
  'zoom-out': { paths: ['M15.5 15.5L21 21M7.5 10.5h6'], circles: [[10.5, 10.5, 6.5]] },
  fullscreen: { paths: ['M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'] },
  'exit-fullscreen': { paths: ['M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5'] },
  eye: { paths: ['M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z'], circles: [[12, 12, 3]] },
  'eye-off': { paths: ['M10.6 5.1A9.8 9.8 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3 3.7M6.6 6.6A17 17 0 0 0 2 12s4 7 10 7a9.5 9.5 0 0 0 4.4-1.1M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18'] },
  // Mục chính (5)
  home: { paths: ['M4 11l8-7 8 7v9H4z'] },
  route: { paths: ['M8 19h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7'], circles: [[6, 19, 2], [18, 5, 2]] },
  pencil: { paths: ['M4 20l4-1 11-11-3-3L5 16zM14 6l3 3'] },
  timer: { paths: ['M12 9v4l3 2M9 2h6'], circles: [[12, 13, 8]] },
  books: { paths: ['M4 4h5v16H4zM9 4h5v16H9zM15 6l3-1 3 14-3 1z'] },
  // Thời gian và thông báo (5)
  calendar: { paths: ['M4 5h16v15H4zM4 9h16M8 3v4M16 3v4'] },
  clock: { paths: ['M12 7v5l3.5 2'], circles: [[12, 12, 9]] },
  history: { paths: ['M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 7v5l3 2'] },
  bell: { paths: ['M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 21h4'] },
  mail: { paths: ['M3 5h18v14H3zM3 7l9 7 9-7'] },
  // Tài khoản và hệ thống (8)
  user: { paths: ['M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1'], circles: [[12, 8, 4]] },
  users: { paths: ['M2.5 20a6.5 6.5 0 0 1 13 0M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14a6.5 6.5 0 0 1 3.5 6'], circles: [[9, 8, 3.5]] },
  settings: { paths: ['M4 6h8M16 6h4M4 12h3M11 12h9M4 18h10M18 18h2'], circles: [[14, 6, 2], [9, 12, 2], [16, 18, 2]] },
  logout: { paths: ['M9 4H4v16h5M16 8l4 4-4 4M20 12H9'] },
  lock: { paths: ['M5 11h14v9H5zM8 11V8a4 4 0 0 1 8 0v3'] },
  unlock: { paths: ['M5 11h14v9H5zM8 11V8a4 4 0 0 1 7.5-2'] },
  shield: { paths: ['M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z'] },
  device: { paths: ['M3 5h18v11H3zM8 20h8M12 16v4'] },
} as const satisfies Record<string, IconShape>;

/**
 * Not on ThanhPhanNenTang: the three theme-choice icons of CheDoToi.dc.html §3
 * (UIBASE-0056 FR-021: sun = Sáng, moon = Tối, half disc = Theo thiết bị).
 */
export const THEME_ICONS = {
  sun: { paths: ['M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4'], circles: [[12, 12, 4]] },
  moon: { paths: ['M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5z'] },
  'theme-device': { paths: [], circles: [[12, 12, 8]], fills: ['M12 4v16a8 8 0 0 0 0-16z'] },
} as const satisfies Record<string, IconShape>;

export const ICON_SET = { ...SHEET_ICONS, ...THEME_ICONS } as const;

export type SheetIconName = keyof typeof SHEET_ICONS;
export type IconName = keyof typeof ICON_SET;

/** Sheet groups with each icon's Vietnamese label, for /ui-library and tests. */
export const ICON_GROUPS: readonly { name: string; icons: readonly (readonly [SheetIconName, string])[] }[] = [
  { name: 'Điều hướng và chỉ hướng', icons: [['menu', 'Menu'], ['chev-down', 'Mở'], ['chev-up', 'Gập'], ['chev-left', 'Trước'], ['chev-right', 'Sau'], ['arrow-left', 'Quay lại'], ['arrow-right', 'Tiếp tục'], ['arrow-up', 'Tăng'], ['arrow-down', 'Giảm'], ['external', 'Mở trang ngoài'], ['close', 'Đóng'], ['more', 'Thêm'], ['drag', 'Kéo thả']] },
  { name: 'Thao tác với nội dung', icons: [['plus', 'Thêm'], ['minus', 'Bớt'], ['trash', 'Xoá'], ['copy', 'Sao chép'], ['save', 'Lưu'], ['download', 'Tải xuống'], ['upload', 'Tải lên'], ['print', 'In'], ['link', 'Liên kết'], ['refresh', 'Tải lại, thử lại'], ['highlight', 'Tô sáng'], ['note', 'Ghi chú'], ['bookmark', 'Đã lưu'], ['flag', 'Đánh dấu'], ['star', 'Đánh giá sao']] },
  { name: 'Phát nghe và ghi âm', icons: [['play', 'Phát'], ['pause', 'Tạm dừng'], ['stop', 'Dừng ghi'], ['back-10', 'Lùi 10 giây'], ['fwd-10', 'Tới 10 giây'], ['repeat', 'Lặp đoạn'], ['speed', 'Tốc độ'], ['volume', 'Nghe'], ['volume-off', 'Tắt tiếng'], ['mic', 'Micro'], ['record', 'Đang ghi âm'], ['subtitles', 'Phụ đề'], ['video', 'Video'], ['headphones', 'Listening']] },
  { name: 'Nội dung và tệp', icons: [['file', 'Tệp'], ['book', 'Reading, bài đọc'], ['image', 'Hình ảnh'], ['folder', 'Thư mục'], ['clipboard', 'Bài được giao'], ['flashcard', 'Thẻ ghi nhớ'], ['chart', 'Biểu đồ'], ['trend', 'Xu hướng'], ['target', 'Mục tiêu'], ['lightbulb', 'Mẹo'], ['sparkle', 'AI, gợi ý'], ['qr', 'Mã QR'], ['credit-card', 'Thanh toán']] },
  { name: 'Trạng thái và cảnh báo', icons: [['check', 'Đúng, đã xong'], ['check-circle', 'Đạt'], ['x-circle', 'Chưa đúng'], ['warning', 'Cảnh báo'], ['error', 'Lỗi'], ['info', 'Thông tin'], ['help', 'Trợ giúp'], ['circle', 'Chưa bắt đầu'], ['partial', 'Đang làm dở'], ['offline', 'Mất mạng'], ['inbox', 'Hộp trống'], ['checkbox', 'Ô chọn đã chọn']] },
  { name: 'Tìm, lọc, xem', icons: [['search', 'Tìm'], ['filter', 'Lọc'], ['sort', 'Sắp xếp'], ['zoom-in', 'Phóng to'], ['zoom-out', 'Thu nhỏ'], ['fullscreen', 'Toàn màn hình'], ['exit-fullscreen', 'Thoát toàn màn hình'], ['eye', 'Xem'], ['eye-off', 'Ẩn']] },
  { name: 'Mục chính', icons: [['home', 'Hôm nay'], ['route', 'Lộ trình'], ['pencil', 'Luyện tập'], ['timer', 'Thi thử'], ['books', 'Thư viện']] },
  { name: 'Thời gian và thông báo', icons: [['calendar', 'Ngày'], ['clock', 'Giờ, đang chờ'], ['history', 'Lịch sử, nhật ký'], ['bell', 'Thông báo'], ['mail', 'Thư']] },
  { name: 'Tài khoản và hệ thống', icons: [['user', 'Người dùng'], ['users', 'Lớp, nhóm người'], ['settings', 'Cài đặt'], ['logout', 'Đăng xuất'], ['lock', 'Đã khoá'], ['unlock', 'Mở khoá'], ['shield', 'Quyền truy cập'], ['device', 'Thiết bị']] },
];
