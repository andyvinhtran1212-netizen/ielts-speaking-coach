// Route-group cần đăng nhập cho `/full-test`.
//
// `AuthedShell` lo toàn bộ `<head>` + bootstrap; ở đây chỉ khai stylesheet
// RIÊNG của trang. `/css/full-test.css` là tệp vừa tách ra từ `<style>` inline
// của bản legacy — cả hai vế nạp CÙNG một tệp, nên cổng parity so được nội dung
// thật chứ không phải hai bản chép.
import type { ReactNode } from 'react';

import { AuthedShell } from '@/components/authed-shell';

export default function FullTestLayout({ children }: { children: ReactNode }) {
  return (
    <AuthedShell pageStylesheets={['/css/full-test.css']}>{children}</AuthedShell>
  );
}
