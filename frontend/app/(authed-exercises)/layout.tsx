// Route-group của trang Exercises (`/exercises`).
//
// GROUP RIÊNG CHO MỖI TRANG: hai tệp CSS của `exercises` và `flashcards` định
// nghĩa lại cùng selector với giá trị KHÁC nhau (`.spinner` khác tên animation,
// `.state-msg` khác màu/padding — đo được), nên nạp chung là hỏng trang kia.
// CSS trang phải đứng TRƯỚC tailwind (đúng bản legacy), mà vị trí đó do
// `AuthedShell` quyết định qua `pageStylesheets` — nên nó phải ở layout.
//
// Mặc định của khung khớp sẵn trang này: `ds.css` + tailwind + body class
// `av-page font-sans min-h-screen`, giống hệt bản legacy.
import type { ReactNode } from 'react';

import { AuthedShell } from '@/components/authed-shell';

export default function AuthedExercisesLayout({ children }: { children: ReactNode }) {
  return (
    <AuthedShell pageStylesheets={['/css/exercises.css']}>
      {children}
    </AuthedShell>
  );
}
