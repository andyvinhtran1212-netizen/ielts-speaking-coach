// Sections of the component library page `/ui-library` (UIBASE-0056 FR-013/014).
// One entry per section; the page renders `<section id={id}>` for each and the
// visual test (tests/visual/ui-library.spec.mjs) screenshots each one at 1280px
// and 390px. Component PRs (G03-T05…T18) append their entries here.
export const UI_LIBRARY_SECTIONS = Object.freeze([
  Object.freeze({ id: 'tokens-colour', title: 'Màu' }),
  Object.freeze({ id: 'tokens-type', title: 'Cỡ chữ và độ đậm' }),
  Object.freeze({ id: 'tokens-vietnamese', title: 'Dấu tiếng Việt và IPA' }),
  Object.freeze({ id: 'tokens-space', title: 'Khoảng cách, bo góc, đường kẻ, focus' }),
  Object.freeze({ id: 'button', title: 'Nút' }),
  Object.freeze({ id: 'icon-button', title: 'Nút biểu tượng' }),
  Object.freeze({ id: 'text-field', title: 'Ô nhập một dòng' }),
  Object.freeze({ id: 'text-area', title: 'Ô nhập nhiều dòng' }),
  Object.freeze({ id: 'select', title: 'Danh sách chọn' }),
  Object.freeze({ id: 'search-field', title: 'Ô tìm' }),
  Object.freeze({ id: 'choice-group', title: 'Chọn một, chọn nhiều' }),
  Object.freeze({ id: 'status-badge', title: 'Nhãn trạng thái' }),
  Object.freeze({ id: 'notice', title: 'Thông báo' }),
  Object.freeze({ id: 'dialog', title: 'Lớp phủ: modal và ngăn kéo' }),
  Object.freeze({ id: 'confirm-dialog', title: 'Hộp hỏi lại' }),
  Object.freeze({ id: 'page-state', title: 'Trạng thái trang' }),
  Object.freeze({ id: 'media-placeholder', title: 'Chỗ trống nội dung' }),
  Object.freeze({ id: 'tabs', title: 'Thẻ' }),
  Object.freeze({ id: 'breadcrumb', title: 'Vị trí trang và quay lại' }),
  Object.freeze({ id: 'pagination', title: 'Phân trang' }),
  Object.freeze({ id: 'progress-bar', title: 'Thanh tiến độ' }),
  Object.freeze({ id: 'stepper', title: 'Quy trình nhiều bước' }),
  Object.freeze({ id: 'theme', title: 'Sáng, tối, theo thiết bị' }),
  Object.freeze({ id: 'focus-shell', title: 'Thanh tập trung' }),
]);
