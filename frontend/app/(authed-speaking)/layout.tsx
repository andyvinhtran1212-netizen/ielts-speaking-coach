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
    <AuthedShell
      pageStylesheets={['/css/speaking.css']}
      extraScripts={
        <>
          {/* Ba script bản legacy nạp mà khung dùng chung không có. Codex bắt
              được thiếu `cue-card-detector.js` ở PR #936: không có nó thì
              `window.CueCardDetector` là undefined, và mọi đường "câu hỏi tự
              nhập" ném TypeError thay vì tạo phiên — build vẫn xanh vì lỗi chỉ
              xảy ra lúc người dùng bấm.

              Đã kiểm cả ba trước khi nạp (bài học `home-mock-tiles.js` ở PR
              #930): không cái nào TỰ CHẠY hay gọi API lúc nạp, chúng chỉ định
              nghĩa global. Nạp bằng thẻ script là an toàn.

              THỨ TỰ QUAN TRỌNG: script `defer` chạy theo thứ tự tài liệu, và
              `cue-card-detector.js` tự ném lỗi nếu `window.api.post` chưa có
              ("ensure api.js is loaded before cue-card-detector.js"). Khung đã
              nạp api.js trước điểm chèn này. */}
          {/* Chart.js — cùng pin CDN với bản legacy (chart.js@4.5.1). Chỉ trang
              này dùng, nên KHÔNG đưa vào khung dùng chung. Thư viện thuần, không
              tự gọi API lúc nạp. */}
          <script src="https://cdn.jsdelivr.net/npm/chart.js@4.5.1" defer />
          <script src="/js/format.js" defer />
          <script src="/js/cue-card-detector.js" defer />
          <script src="/js/retention-warning.js" defer />
        </>
      }
    >
      {children}
    </AuthedShell>
  );
}
