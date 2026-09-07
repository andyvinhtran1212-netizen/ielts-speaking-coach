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
import Script from 'next/script';

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
              nghĩa global. Dùng Next Script `afterInteractive` để chúng được
              thực thi cả khi người dùng mở route bằng client navigation; một
              thẻ script React thường chỉ đáng tin ở hard load.

              `cue-card-detector.js` đòi `window.api.post`. Khung chung nạp
              api.js trước hydration ở hard load; khi client-navigation vào
              route thì khung và api đã tồn tại. */}
          {/* Chart.js — cùng pin CDN với bản legacy (chart.js@4.5.1). Chỉ trang
              này dùng, nên KHÔNG đưa vào khung dùng chung. Thư viện thuần, không
              tự gọi API lúc nạp. */}
          <Script
            src="https://cdn.jsdelivr.net/npm/chart.js@4.5.1"
            strategy="afterInteractive"
          />
          <Script src="/js/format.js" strategy="afterInteractive" />
          <Script src="/js/cue-card-detector.js" strategy="afterInteractive" />
          <Script src="/js/retention-warning.js" strategy="afterInteractive" />
        </>
      }
    >
      {children}
    </AuthedShell>
  );
}
