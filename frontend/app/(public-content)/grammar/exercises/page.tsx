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
  // Su kien load xay ra sau khi React da hydrate xong cay; them mot macrotask
  // nua cho chac. KHONG dung dau nguoc trong chu thich nay: no nam TRONG mot
  // template literal, va mot dau nguoc se ket thuc chuoi som.
  if (document.readyState === 'complete') setTimeout(fn, 0);
  else window.addEventListener('load', () => setTimeout(fn, 0), { once: true });
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
      const el = document.getElementById('ex-skeleton');
      if (el) el.textContent = 'Khong tai duoc bai tap. Vui long tai lai trang.';
    }
  }, 20);
}
`.trim();

export default function GrammarExercisesPage() {
  return (
    <>
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
