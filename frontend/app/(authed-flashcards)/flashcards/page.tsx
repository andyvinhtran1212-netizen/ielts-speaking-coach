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
import HydratedSignal from '@/components/hydrated-signal';

export const metadata: Metadata = {
  // Byte-faithful với <title> của bản legacy
  title: 'Flashcards — Aver Learning',
  robots: { index: false, follow: false },
};

// NGÂN SÁCH CHỜ PHẢI KHỚP KHUNG: `auth-provider.tsx:51`
// (`SUPABASE_READY_TIMEOUT_MS = 10_000`) và `when-global-ready.mjs:30` đều cho
// 10s. Bản đầu tôi để 3s — trên mạng chậm, Supabase sẵn sàng ở giây thứ 5 thì
// khung vẫn đang chờ trong khi trang này ĐÃ thay nội dung bằng thông báo lỗi
// vĩnh viễn (bot bắt ở #958). Một hạn giờ chặt hơn khung là tự tạo lỗi giả.
const MOUNT = `
import { mount } from '/js/vocab-modules/flashcards.js';
const afterHydration = (fn) => {
  // React TU BAO khi hydrate xong (components/hydrated-signal.tsx). KHONG doan
  // theo su kien load: no chi noi tai nguyen da tai xong, con React 18/19
  // hydrate theo che do dong thoi nen co the CHUA xong luc load ban.
  // KHONG dung dau nguoc trong chu thich nay: no nam TRONG mot template literal.
  if (window.__averHydrated) { fn(); return; }
  window.addEventListener("aver:hydrated", fn, { once: true });
  // Cho chet: chunk React hong han thi useEffect khong chay, co khong bat, va
  // trang dung im vinh vien. KHONG goi thang fn() - React chi CHAM thoi thi lam
  // vay la dung lai dung cuoc dua vua sua. Sang han ban legacy, giu query/hash.
  setTimeout(() => {
    if (window.__averHydrated) return;
    console.error("[aver] React khong hydrate sau 12s - sang ban legacy");
    window.location.replace("/pages/flashcards.html" + window.location.search + window.location.hash);
  }, 12000);
};
const ready = () => typeof window.getSupabase === 'function' && !!window.getSupabase();
const go = () => mount(document.getElementById('mount'), { embedded: false });
if (ready()) afterHydration(go);
else {
  let n = 0;
  const iv = setInterval(() => {
    if (ready()) { clearInterval(iv); afterHydration(go); }
    else if (++n > 500) {  // 500 x 20ms = 10s
      clearInterval(iv);
      // HIỆN LỖI, không chỉ console.error: hết giờ mà im lặng thì học viên
      // ngồi nhìn spinner quay mãi (flashcards còn trắng trơn) và không biết
      // vì sao. Review cục bộ bắt ở #958.
      console.error('[flashcards] Supabase khong san sang sau 10s');
      // Nhanh nay cung DOI DOM nen cung phai cho hydrate.
      afterHydration(() => {
  const el = document.getElementById('mount');
        if (el) el.innerHTML = '<div class="state-msg">Khong tai duoc phien dang nhap. '
          + 'Vui long tai lai trang.</div>';
      });
    }
  }, 20);
}
`.trim();

export default function FlashcardsPage() {
  return (
    <>
      {/* Chrome chung. Layout chỉ NẠP script; phần tử phải do từng trang dựng. */}
      <HydratedSignal />
      {/* @ts-ignore */}
      <aver-chrome active="vocabulary" />
      {/* Hộp để module dựng thân trang vào — Sprint 7.4. Bản legacy để RỖNG. */}
      <main id="mount" className="vocab-module-mount"></main>
      <script type="module" dangerouslySetInnerHTML={{ __html: MOUNT }} />
    </>
  );
}
