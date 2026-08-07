// Trang "Thống kê luyện tập" trên Next — `/quiz/progress`.
//
// Cùng khuôn các trang port trước: JS và CSS đã tách khỏi mã inline, CẢ HAI VẾ
// nạp chung tệp đó.
import type { Metadata } from 'next';

export const metadata: Metadata = {
  // Byte-faithful với <title> của bản legacy
  title: 'Thống kê luyện tập',
  robots: { index: false, follow: false },
};

const MOUNT = `
import { mount } from '/js/quiz-progress.js';
const ready = () => typeof window.getSupabase === 'function' && !!window.getSupabase();
if (ready()) mount();
else {
  let n = 0;
  const iv = setInterval(() => {
    if (ready()) { clearInterval(iv); mount(); }
    else if (++n > 500) {  // 500 x 20ms = 10s
      clearInterval(iv);
      console.error('[quiz-progress] Supabase khong san sang sau 10s');
      const err = document.getElementById('pg-error');
      const load = document.getElementById('pg-loading');
      if (err) {
        err.textContent = 'Khong tai duoc phien dang nhap. Vui long tai lai trang.';
        err.classList.remove('hidden');
      }
      if (load) load.classList.add('hidden');
    }
  }, 20);
}
`.trim();

export default function QuizProgressPage() {
  return (
    <>
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
