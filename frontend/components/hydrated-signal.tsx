'use client';

// React TỰ BÁO khi đã hydrate xong. Không đoán.
//
// VÌ SAO CÓ TỆP NÀY: bảy trang port sang Next đều nạp module legacy bằng một
// `<script type="module">`, và module đó ĐỔI DOM. Chạy trước khi React hydrate
// thì React thấy cây không khớp HTML máy chủ, vứt bản máy chủ và dựng lại từ
// đầu — xoá sạch thay đổi của module, trang quay về "Đang tải…". Đó là React
// #418, và nó đã xảy ra THẬT trên production.
//
// TIỀN ĐỀ SAI PHẢI BỎ: bản vá đầu tôi chờ sự kiện `load` rồi cộng thêm một
// macrotask, kèm chú thích "load xảy ra sau khi React đã hydrate xong cây".
// Điều đó KHÔNG đúng. `load` chỉ nói mọi tài nguyên đã tải xong; React 18/19
// hydrate theo chế độ ĐỒNG THỜI, tức việc hydrate được lên lịch và có thể bị
// ngắt quãng, nên nó hoàn toàn có thể chưa xong lúc `load` bắn.
//
// Đo được, lặp lại 3/3 khi ép chunk chậm 900ms trên `/speaking/result`: mốc
// ~990ms module ghi chữ vào `#state-error` và đổi lớp `#state-loading`, rồi
// ~10ms sau React gỡ bỏ và dựng lại `AVER-CHROME`, `DIV`, `SCRIPT`. Năm trang
// còn lại thoát chỉ vì nhịp khác — tức MAY, không phải đúng.
//
// Hiệu ứng (`useEffect`) chạy SAU pha commit, và với hydrate thì commit chính
// là lúc cây đã khớp xong. Đó là tín hiệu duy nhất đáng tin, và nó đến từ chính
// React chứ không từ suy đoán của tôi về thứ tự sự kiện trình duyệt.
//
// Trang LEGACY không có React nên không dùng tệp này; bản legacy giữ nguyên
// đường nạp cũ của nó.
import { useEffect } from 'react';

/** Tên dùng chung giữa component này và các `<script type="module">` của trang. */
export const HYDRATED_FLAG = '__averHydrated';
export const HYDRATED_EVENT = 'aver:hydrated';

export default function HydratedSignal() {
  useEffect(() => {
    // Đặt CỜ trước rồi mới phát sự kiện: module có thể chạy sau lúc này, và khi
    // đó nó đã lỡ sự kiện — chỉ còn cờ để đọc. Thiếu cờ thì đúng những lần
    // hydrate NHANH hơn module sẽ treo mãi, tức vá xong lại sinh lỗi mới.
    (window as unknown as Record<string, unknown>)[HYDRATED_FLAG] = true;
    window.dispatchEvent(new Event(HYDRATED_EVENT));
  }, []);
  return null;
}
