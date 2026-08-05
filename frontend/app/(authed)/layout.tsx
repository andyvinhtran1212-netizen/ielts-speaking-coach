// Route-group cần đăng nhập — hiện chỉ có `/profile` (pilot 3+4).
//
// Toàn bộ `<head>` + bootstrap nằm ở `components/authed-shell.tsx`, dùng chung
// với các route-group cần đăng nhập khác. Trước đây tệp này và
// `(authed-home)/layout.tsx` là hai bản chép gần như trùng nhau — khác đúng
// danh sách stylesheet — nên mỗi bài học về thứ tự script phải vá hai chỗ.
//
// CHỈ CÒN KHÁC BIỆT THẬT: `/css/profile.css`.
//
// Auth là CLIENT-ONLY (ADR-003 §3): layout này là Server Component nhưng không
// đọc cookie/header — nó dựng vỏ tĩnh rồi mount AuthProvider, thứ tiêu thụ
// client Supabase mà api.js tạo ra trên window.
import type { ReactNode } from 'react';

import { AuthedShell } from '@/components/authed-shell';

export default function AuthedLayout({ children }: { children: ReactNode }) {
  return (
    <AuthedShell pageStylesheets={['/css/profile.css']}>{children}</AuthedShell>
  );
}
