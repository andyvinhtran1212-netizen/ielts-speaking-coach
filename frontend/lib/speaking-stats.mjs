// Phần THUẦN của cụm thống kê trang Speaking — tách để `node --test` kiểm được
// hành vi thật (`.tsx` không nạp được). Cùng khuôn `lib/speaking-copy.mjs`.

/**
 * Làm tròn về nửa điểm — ĐÚNG như `public/js/format.js:7`.
 *
 * Không import từ đó vì `format.js` là script cổ điển gán vào window, không
 * phải module. Ghim bằng test so trực tiếp với tệp gốc.
 */
export function roundHalf(val) {
  return Math.round(val * 2) / 2;
}

/** Escaper của trang legacy — KHÔNG escape dấu nháy đơn, giữ nguyên hành vi. */
export function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Nhãn + màu badge theo chế độ phiên. */
export const MODE_BADGE = {
  practice: { label: 'Luyện tập', bg: 'var(--av-primary-soft)', fg: 'var(--av-primary)' },
  test_part: { label: 'Part Test', bg: 'var(--av-info-soft)', fg: 'var(--av-info)' },
  test_full: { label: 'Full Test', bg: 'var(--av-warning-soft)', fg: 'var(--av-warning)' },
};

/**
 * Có bộ lọc nào đang bật không.
 *
 * QUAN TRỌNG cho ĐÚNG một quyết định: bảng rỗng vì LỌC ra 0 kết quả khác hẳn
 * bảng rỗng vì CHƯA CÓ session nào. Khối "chưa có gì" chỉ được hiện ở ca thứ
 * hai — nếu không, người vừa gõ một từ khoá không khớp sẽ đọc thành "bạn chưa
 * luyện buổi nào".
 *
 * `sort` mặc định là 'newest' nên nó KHÔNG tính là bộ lọc đang bật.
 */
export function historyHasActiveFilters(st) {
  return !!(st && (st.search || st.date_from || st.date_to
    || (st.sort && st.sort !== 'newest')));
}

/**
 * Thời gian tương đối — chép nguyên `fmtRelTime` của trang legacy.
 *
 * Mốc dưới 1 phút và đúng 1 phút đều trả 'vừa xong' (`mins <= 1`) — trông như
 * lệch nhưng đó đúng là bản gốc; đổi là làm lệch chữ trên màn hình.
 */
export function fmtRelTime(isoStr) {
  if (!isoStr) return '';
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return mins <= 1 ? 'vừa xong' : `${mins} phút trước`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} giờ trước`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days} ngày trước`;
  return `${Math.floor(days / 30)} tháng trước`;
}
