// Trang "Luyện tập từ vựng" trên Next — `/vocabulary/practice`.
//
// Cùng khuôn `/full-test`: JS và CSS đã tách khỏi mã inline của bản legacy, và
// CẢ HAI VẾ nạp chung tệp đó. Không chép một dòng logic nào sang React.
//
// PHẢI CHỜ SUPABASE SẴN SÀNG trước khi `mount()` — `AuthedShell` gọi
// `initSupabase` ở `DOMContentLoaded`, và đo được ở các trang trước: lúc module
// chạy `getSupabase()` còn rỗng.
import type { Metadata } from 'next';
import HydratedSignal from '@/components/hydrated-signal';

export const metadata: Metadata = {
  // Byte-faithful với <title> của bản legacy
  title: 'Luyện tập từ vựng',
  robots: { index: false, follow: false },
};

// Ngân sách chờ 10s khớp khung (`auth-provider.tsx`, `when-global-ready.mjs`).
// PHẢI CHỜ REACT HYDRATE XONG rồi mới cho mã legacy đụng DOM. Script kiểu module
// chạy TRƯỚC `DOMContentLoaded`; nếu lúc đó điều kiện đã sẵn sàng thì hàm mount
// chạy ngay và ĐỔI DOM trước khi React hydrate → React #418 → nó vứt HTML máy
// chủ và dựng lại từ đầu, xoá sạch thay đổi của script, trang quay về trạng thái
// ban đầu. Đã xảy ra THẬT (G1 bắt ở `/mock/result` rồi `/speaking/result`); các
// trang khác chỉ thoát vì điều kiện chưa sẵn sàng ở nhịp đầu — tức MAY.
const MOUNT = `
import { mount } from '/js/vocab-practice.js';
const afterHydration = (fn) => {
  // React TU BAO khi hydrate xong (components/hydrated-signal.tsx). KHONG doan
  // theo su kien load: ban dau toi cho load roi cong mot macrotask, kem chu
  // thich "load xay ra sau khi React da hydrate xong cay" - dieu do SAI. React
  // hydrate theo che do dong thoi, nen no co the CHUA xong luc load ban. Do
  // duoc, lap lai 3/3 khi ep chunk cham: module ghi DOM truoc, React vut HTML
  // may chu ngay sau. KHONG dung dau nguoc trong chu thich nay: no nam TRONG
  // mot template literal.
  if (window.__averHydrated) { fn(); return; }
  window.addEventListener("aver:hydrated", fn, { once: true });
  // CHO CHET (watchdog). Neu chunk React hong han thi useEffect khong bao gio
  // chay, co khong bat, va trang dung o "Dang tai..." VINH VIEN. Ban cu cho
  // load nen van chay duoc - tuc ban va nay doi mot loi #418 lay mot loi treo.
  // KHONG goi thang fn() o day: React chi CHAM thoi thi lam vay la dung lai
  // cuoc dua vua sua. Thay vao do sang han ban legacy, giu nguyen query/hash.
  setTimeout(() => {
    if (window.__averHydrated) return;
    console.error("[/pages/vocab-practice.html] React khong hydrate sau 12s - sang ban legacy");
    window.location.replace("/pages/vocab-practice.html" + window.location.search + window.location.hash);
  }, 12000);
};
const ready = () => typeof window.getSupabase === 'function' && !!window.getSupabase();
if (ready()) afterHydration(mount);
else {
  let n = 0;
  const iv = setInterval(() => {
    if (ready()) { clearInterval(iv); afterHydration(mount); }
    else if (++n > 500) {  // 500 x 20ms = 10s
      clearInterval(iv);
      console.error('[vocab-practice] Supabase khong san sang sau 10s');
      // Nhanh nay cung DOI DOM, nen no cung phai cho hydrate. Bo sot no thi
      // mot lan chunk React cham hon 10s se tai tao dung loi #418 vua sua
      // (codex bat o #1003).
      afterHydration(() => {
        const err = document.getElementById('vp-error');
        const load = document.getElementById('vp-loading');
        if (err) {
          err.textContent = 'Khong tai duoc phien dang nhap. Vui long tai lai trang.';
          err.classList.remove('hidden');
        }
        if (load) load.classList.add('hidden');
      });
    }
  }, 20);
}
`.trim();

export default function VocabPracticePage() {
  return (
    <>
      <HydratedSignal />
      {/* @ts-ignore */}
      <aver-chrome active="vocabulary" />
      <div className="shell">
        <header className="subpage-header">
          <div className="subpage-header__lhs">
            {/* Back UP to the Vocabulary hub (where the picker is launched from) —
                the same page the chrome "Vocabulary" tab opens for a logged-in user.
                NOT /vocabulary.html (the public word wiki), which is a different page. */}
            <a className="subpage-header__back" href="/pages/vocabulary.html">
              <span aria-hidden="true">←</span><span>Vocabulary</span>
            </a>
            <span className="subpage-header__sep">|</span>
            <h1 className="subpage-header__title">Luyện tập từ vựng</h1>
          </div>
        </header>

        <h2 className="vp-hub-title">Chọn một bài để bắt đầu</h2>
        <p className="vp-hub-sub">
          Mỗi bài <strong>kiểm tra tới khi bạn thuộc trọn vẹn cả list từ</strong> —
          có câu gõ tự luận, chống đoán mò và ôn lại từ hay sai. Tiến độ được lưu để bạn học tiếp ở lần sau.
        </p>

        <p id="vp-loading" className="vp-status">Đang tải…</p>
        <div id="vp-list" className="modes-grid hidden"></div>
        <p id="vp-empty" className="vp-status hidden">Chưa có bài luyện nào được mở. Vui lòng quay lại sau.</p>
        <p id="vp-error" className="vp-status is-error hidden"></p>

        <a id="vp-progress" className="vp-progress-link hidden" href="/pages/quiz-progress.html?skill_area=vocab">📊 Xem tiến độ của tôi →</a>
      </div>
      <script type="module" dangerouslySetInnerHTML={{ __html: MOUNT }} />
    </>
  );
}
