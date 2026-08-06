// Trang Flashcards trên Next — `/flashcards`.
//
// KHUÔN `mount()`: trang legacy không để module tự khởi động mà GỌI
// `mount(el, opts)` tường minh. Bản Next làm y hệt bằng script kiểu module nội
// tuyến — vẫn là CHÍNH module legacy, không chép logic.
//
// PHẢI CHỜ SUPABASE SẴN SÀNG, và đây là chỗ đã sai hai lần trước khi đo ra:
//   · Bản legacy gọi `initSupabase(...)` trong script thường NGAY TRƯỚC module.
//   · `AuthedShell` gọi nó ở `DOMContentLoaded`, nhưng ĐO ĐƯỢC: lúc module chạy
//     `getSupabase()` còn rỗng, và chỉ sau ~1 nhịp 20ms mới có phiên đầy đủ.
//     Hoãn tới `DOMContentLoaded` KHÔNG đủ — tôi đã thử và vẫn hỏng.
// Không chờ thì `_loader.js` thấy token rỗng và ĐÁ VỀ `/index.html` (Next 307
// sang `/`): bản Next nhảy về trang chủ trong khi legacy ở nguyên trang.
import type { Metadata } from 'next';

export const metadata: Metadata = {
  // Byte-faithful với <title> của bản legacy
  title: 'Flashcards — Aver Learning',
  robots: { index: false, follow: false },
};

const MOUNT = `
import { mount } from '/js/vocab-modules/flashcards.js';
const ready = () => typeof window.getSupabase === 'function' && !!window.getSupabase();
const go = () => mount(document.getElementById('mount'), { embedded: false });
if (ready()) go();
else {
  let n = 0;
  const iv = setInterval(() => {
    if (ready()) { clearInterval(iv); go(); }
    else if (++n > 150) {
      clearInterval(iv);
      // HIỆN LỖI, không chỉ console.error: hết giờ mà im lặng thì học viên
      // ngồi nhìn spinner quay mãi (flashcards còn trắng trơn) và không biết
      // vì sao. Review cục bộ bắt ở #958.
      console.error('[flashcards] Supabase khong san sang sau 3s');
      const el = document.getElementById('mount');
      if (el) el.innerHTML = '<div class="state-msg">Khong tai duoc phien dang nhap. '
        + 'Vui long tai lai trang.</div>';
    }
  }, 20);
}
`.trim();

export default function FlashcardsPage() {
  return (
    <>
      {/* Chrome chung. Layout chỉ NẠP script; phần tử phải do từng trang dựng. */}
      {/* @ts-ignore */}
      <aver-chrome active="vocabulary" />
      {/* Hộp để module dựng thân trang vào — Sprint 7.4. Bản legacy để RỖNG. */}
      <main id="mount" className="vocab-module-mount"></main>
      <script type="module" dangerouslySetInnerHTML={{ __html: MOUNT }} />
    </>
  );
}
