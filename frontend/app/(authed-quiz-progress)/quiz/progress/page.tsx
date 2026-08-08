// Trang "Thống kê luyện tập" trên Next — `/quiz/progress`.
//
// Cùng khuôn các trang port trước: JS và CSS đã tách khỏi mã inline, CẢ HAI VẾ
// nạp chung tệp đó.
import type { Metadata } from 'next';
import HydratedSignal from '@/components/hydrated-signal';

export const metadata: Metadata = {
  // Byte-faithful với <title> của bản legacy
  title: 'Thống kê luyện tập',
  robots: { index: false, follow: false },
};

// PHẢI CHỜ REACT HYDRATE XONG rồi mới cho mã legacy đụng DOM. Script kiểu module
// chạy TRƯỚC `DOMContentLoaded`; nếu lúc đó điều kiện đã sẵn sàng thì hàm mount
// chạy ngay và ĐỔI DOM trước khi React hydrate → React #418 → nó vứt HTML máy
// chủ và dựng lại từ đầu, xoá sạch thay đổi của script, trang quay về trạng thái
// ban đầu. Đã xảy ra THẬT (G1 bắt ở `/mock/result` rồi `/speaking/result`); các
// trang khác chỉ thoát vì điều kiện chưa sẵn sàng ở nhịp đầu — tức MAY.
const MOUNT = `
import { mount } from '/js/quiz-progress.js';
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
    console.error("[/pages/quiz-progress.html] React khong hydrate sau 12s - sang ban legacy");
    window.location.replace("/pages/quiz-progress.html" + window.location.search + window.location.hash);
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
      console.error('[quiz-progress] Supabase khong san sang sau 10s');
      // Nhanh nay cung DOI DOM, nen no cung phai cho hydrate. Bo sot no thi
      // mot lan chunk React cham hon 10s se tai tao dung loi #418 vua sua
      // (codex bat o #1003).
      afterHydration(() => {
        const err = document.getElementById('pg-error');
        const load = document.getElementById('pg-loading');
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

export default function QuizProgressPage() {
  return (
    <>
      <HydratedSignal />
      {/* @ts-ignore */}
      <aver-chrome active="vocabulary" />

      <main className="av-w-read pg-shell">
        <header className="subpage-header">
          <div className="subpage-header__lhs">
            {/* Target is set from ?skill_area= in the script below: a grammar
                Quick-Check must not send the learner back to the vocab picker. */}
            <a id="pg-back" className="subpage-header__back" href="/pages/vocab-practice.html"><span aria-hidden="true">←</span><span id="pg-back-label">Luyện tập</span></a>
          </div>
        </header>
        <h1 className="pg-title">📊 Thống kê luyện tập</h1>
        <p className="pg-sub">Tổng hợp kết quả Quick-Check của bạn.</p>

        <p id="pg-loading" className="pg-empty">Đang tải…</p>

        <div id="pg-main" className="hidden">
          <div className="pg-stats" id="pg-totals"></div>

          <h2 className="pg-h2">Theo bộ</h2>
          <div id="pg-banks"></div>

          <h2 className="pg-h2">Câu tôi đã trả lời sai</h2>
          <p className="pg-sub">Bấm vào một từ để xem lại câu hỏi, đáp án bạn đã chọn và đáp án đúng.</p>
          <div id="pg-mistakes"></div>
          <p id="pg-mistakes-cap" className="pg-cap hidden"></p>

          <h2 className="pg-h2">Phiên gần đây</h2>
          <div id="pg-sessions"></div>
        </div>

        <p id="pg-error" className="hidden pg-err"></p>
      </main>
      <script type="module" dangerouslySetInnerHTML={{ __html: MOUNT }} />
    </>
  );
}
