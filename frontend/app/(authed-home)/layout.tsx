// Route-group của trang chủ học viên (`/home`).
//
// Toàn bộ `<head>` + bootstrap nằm ở `components/authed-shell.tsx`, dùng chung
// với `(authed)`. Route-group này vẫn tách riêng vì `home.css` có LUẬT TOÀN CỤC
// (`* { box-sizing }`, `html, body`, `a`) còn `profile.css` thì KHÔNG — nạp
// home.css lên `/profile` là đổ ba luật đó lên một trang đang chạy. Nên khác
// biệt nằm ở DANH SÁCH STYLESHEET, không phải ở một bản chép layout thứ hai.
import type { ReactNode } from 'react';

import { AuthedShell } from '@/components/authed-shell';

export default function AuthedHomeLayout({ children }: { children: ReactNode }) {
  return (
    <AuthedShell
      // Mock hub: cùng MỘT nguồn với trang legacy (review #929).
      pageStylesheets={['/css/home.css', '/css/mock-hub.css']}
      extraScripts={
        // `speaking-debt.js` chỉ ĐỊNH NGHĨA `window.SpeakingDebt` — không tự gọi
        // API nào lúc nạp — nên nạp bằng thẻ script là an toàn. `home-behavior.tsx`
        // gọi `retryAll()` sau khi home-summary trả về: practice.js chỉ nạp ở trang
        // luyện tập, nên học viên đóng tab hoàn thành rồi quay lại ĐÂY — đường về
        // bình thường sau kỳ thi — sẽ để lượt thi kẹt ở `speaking_pending` mãi mãi
        // (Codex review, PR #847).
        //
        // KHÔNG nạp `home-mock-tiles.js` ở đây, dù bản legacy có: nó TỰ CHẠY lúc
        // `DOMContentLoaded` và gọi ngay `/api/mock-exams/my-sittings` → 401 →
        // `api.js:130` đẩy sang `/login` và CẢ TRANG biến mất (cổng parity bắt
        // được ở PR #930). Logic đó đã port vào `home-behavior.tsx`.
        <script src="/js/speaking-debt.js" defer />
      }
    >
      {children}
    </AuthedShell>
  );
}
