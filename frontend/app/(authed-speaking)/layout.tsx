// Route-group của trang Speaking (`/speaking`).
//
// `<head>` + bootstrap dùng chung qua `components/authed-shell.tsx` — khung này
// dựng ở PR trước đúng để trang thứ ba không phải chép lại lần nữa.
//
// VÌ SAO VẪN LÀ ROUTE-GROUP RIÊNG chứ không nhét vào `(authed)`: khác biệt là
// CSS của trang. `speaking.css` có 0 luật toàn cục (đếm được) nên nó KHÔNG làm
// hỏng trang khác, nhưng `profile.css` cũng sẽ đổ lên `/speaking` nếu dùng
// chung group — mà hai tệp có chung nhiều tên class chung chung. Tách group là
// cách rẻ nhất để mỗi trang chỉ nhận đúng CSS của nó.
import type { ReactNode } from 'react';

import { AuthedShell } from '@/components/authed-shell';

export default function AuthedSpeakingLayout({ children }: { children: ReactNode }) {
  return (
    <AuthedShell pageStylesheets={['/css/speaking.css']}>{children}</AuthedShell>
  );
}
