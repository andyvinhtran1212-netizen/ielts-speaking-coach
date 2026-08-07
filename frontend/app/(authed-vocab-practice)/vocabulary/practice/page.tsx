// Trang "Luyện tập từ vựng" trên Next — `/vocabulary/practice`.
//
// Cùng khuôn `/full-test`: JS và CSS đã tách khỏi mã inline của bản legacy, và
// CẢ HAI VẾ nạp chung tệp đó. Không chép một dòng logic nào sang React.
//
// PHẢI CHỜ SUPABASE SẴN SÀNG trước khi `mount()` — `AuthedShell` gọi
// `initSupabase` ở `DOMContentLoaded`, và đo được ở các trang trước: lúc module
// chạy `getSupabase()` còn rỗng.
import type { Metadata } from 'next';

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
  // Su kien load xay ra sau khi React da hydrate xong cay; them mot macrotask
  // nua cho chac. KHONG dung dau nguoc trong chu thich nay: no nam TRONG mot
  // template literal, va mot dau nguoc se ket thuc chuoi som.
  if (document.readyState === 'complete') setTimeout(fn, 0);
  else window.addEventListener('load', () => setTimeout(fn, 0), { once: true });
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
      const err = document.getElementById('vp-error');
      const load = document.getElementById('vp-loading');
      if (err) {
        err.textContent = 'Khong tai duoc phien dang nhap. Vui long tai lai trang.';
        err.classList.remove('hidden');
      }
      if (load) load.classList.add('hidden');
    }
  }, 20);
}
`.trim();

export default function VocabPracticePage() {
  return (
    <>
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
