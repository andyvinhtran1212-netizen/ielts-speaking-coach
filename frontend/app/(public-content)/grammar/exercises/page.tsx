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
const MOUNT = `
import { mount } from '/js/grammar-exercises.js';
const ready = () => !!(window.api && window.api.get);
if (ready()) mount();
else {
  let n = 0;
  const iv = setInterval(() => {
    if (ready()) { clearInterval(iv); mount(); }
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
          <nav className="text-sm text-white/40 mb-3">
            <a href="/grammar" className="hover:text-white/70">Grammar Wiki</a>
            <span className="mx-1">/</span>
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
