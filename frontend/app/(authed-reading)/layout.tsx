// Route-group của các trang Reading (`/reading/*`).
//
// Group riêng vì CSS riêng — cùng lý do đã ghi ở `(authed-speaking)`.
//
// ĐIỂM KHÁC hẳn ba trang đã port trước: nhóm này KHÔNG có tệp hành vi. Toàn bộ
// logic của trang legacy nằm sẵn trong một ES module ở `public/js/`, và bản Next
// nạp ĐÚNG tệp đó. Không chép lại một dòng nào ⇒ không có cơ hội cho bản port
// lệch khỏi bản gốc, và khi sửa thì sửa một chỗ cho cả hai vế.
//
// Đây là lý do nhóm trang chỉ-đọc rẻ hơn hẳn `/writing/dashboard`: trang đó có
// ~1540 dòng JS NỘI TUYẾN nên buộc phải port; những trang này thì không.
import type { ReactNode } from 'react';

import { AuthedShell } from '@/components/authed-shell';

export default function AuthedReadingLayout({ children }: { children: ReactNode }) {
  return (
    <AuthedShell pageStylesheets={['/css/reading-vocab.css']}>
      {children}
    </AuthedShell>
  );
}
