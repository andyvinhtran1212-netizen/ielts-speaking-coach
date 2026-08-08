// Trang "Bài tập Grammar" trên Next — `/grammar/exercises`.
//
// Khác hai trang port trước ở một điểm: đây là trang CÔNG KHAI, không cần phiên
// đăng nhập. Nên nó nằm trong `(public-content)` — layout đó đã nạp sẵn đúng bộ
// CSS mà bản legacy dùng (tokens → components → ds → grammar-wiki → tailwind) và
// cả `runtime-config.js` + `api.js`. Không cần `AuthedShell`, không cần chờ
// Supabase.
//
// Logic đã tách sang `/js/grammar-exercises.js`; CẢ HAI VẾ chạy chính tệp đó.
import type { Metadata } from 'next';
import HydratedSignal from '@/components/hydrated-signal';

export const metadata: Metadata = {
  // Byte-faithful với <title> của bản legacy
  title: 'Bài tập Grammar — Aver Learning',
};

// Chờ `window.api` chứ không chờ Supabase: trang công khai chỉ cần lớp gọi API.
// Script của layout là `defer` nên chúng chạy theo thứ tự tài liệu trước module
// này, nhưng vẫn chờ có hạn giờ — im lặng hỏng thì học viên ngồi nhìn "Đang tải
// bài tập…" mãi.
// PHẢI CHỜ REACT HYDRATE XONG rồi mới cho mã legacy đụng DOM. Script kiểu module
// chạy TRƯỚC `DOMContentLoaded`; nếu lúc đó điều kiện đã sẵn sàng thì hàm mount
// chạy ngay và ĐỔI DOM trước khi React hydrate → React #418 → nó vứt HTML máy
// chủ và dựng lại từ đầu, xoá sạch thay đổi của script, trang quay về trạng thái
// ban đầu. Đã xảy ra THẬT (G1 bắt ở `/mock/result` rồi `/speaking/result`); các
// trang khác chỉ thoát vì điều kiện chưa sẵn sàng ở nhịp đầu — tức MAY.
const MOUNT = `
import { mount } from '/js/grammar-exercises.js';
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
    console.error("[/pages/grammar-exercises.html] React khong hydrate sau 12s - sang ban legacy");
    window.location.replace("/pages/grammar-exercises.html" + window.location.search + window.location.hash);
  }, 12000);
};
const ready = () => !!(window.api && window.api.get);
if (ready()) afterHydration(mount);
else {
  let n = 0;
  const iv = setInterval(() => {
    if (ready()) { clearInterval(iv); afterHydration(mount); }
    else if (++n > 500) {  // 500 x 20ms = 10s
      clearInterval(iv);
      console.error('[grammar-exercises] window.api khong san sang sau 10s');
      // Nhanh nay cung DOI DOM, nen no cung phai cho hydrate (codex #1003).
      afterHydration(() => {
        const el = document.getElementById('ex-skeleton');
        if (el) el.textContent = 'Khong tai duoc bai tap. Vui long tai lai trang.';
      });
    }
  }, 20);
}
`.trim();

export default function GrammarExercisesPage() {
  return (
    <>
      <HydratedSignal />
      {/* @ts-ignore */}
      <aver-chrome active="grammar" />

      <main className="av-w-page py-8">
        <header className="mb-8">
          {/* `{' '}` là BẮT BUỘC, không phải thẩm mỹ: JSX XOÁ HẲN khoảng trắng
              có xuống dòng giữa các phần tử, nên nếu không chèn thì dòng này ra
              "Grammar Wiki/Bài tập" trong khi legacy là "Grammar Wiki / Bài tập"
              — G1 bắt được đúng chỗ đó (`line-missing`). */}
          <nav className="text-sm text-white/40 mb-3">
            <a href="/grammar" className="hover:text-white/70">Grammar Wiki</a>{' '}
            <span className="mx-1">/</span>{' '}
            <span className="text-white/60">Bài tập</span>
          </nav>
          <h1 className="text-3xl font-extrabold text-white mb-2">Bài tập Grammar</h1>
          <p className="text-white/45">Kiểm tra kiến thức ngữ pháp theo từng bài — làm tới khi thành thạo.</p>
        </header>

        <div id="ex-skeleton" className="text-white/40 py-12 text-center">Đang tải bài tập…</div>
        <div id="ex-empty" className="hidden text-white/40 py-12 text-center">
          Chưa có bài tập nào được mở. Vui lòng quay lại sau.
        </div>
        <div id="ex-groups" className="hidden flex flex-col gap-8"></div>
      </main>
      <script type="module" dangerouslySetInnerHTML={{ __html: MOUNT }} />
    </>
  );
}
