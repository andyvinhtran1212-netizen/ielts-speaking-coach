// Trang "Thi thử Full Test 4 kỹ năng" trên Next — `/full-test`.
//
// Bản legacy để cả JS lẫn CSS INLINE. Port này tách chúng ra
// (`/js/full-test.js`, `/css/full-test.css`) rồi CẢ HAI VẾ dùng chung — không
// chép một dòng logic nào sang React. Chép là hai bản trôi khỏi nhau và cổng
// parity chỉ còn so được cái vỏ.
//
// PHẢI CHỜ SUPABASE SẴN SÀNG trước khi gọi `mount()`. Bản legacy gọi
// `initSupabase(...)` ngay trước module; `AuthedShell` gọi ở `DOMContentLoaded`,
// và ĐO ĐƯỢC ở các trang trước: lúc module chạy `getSupabase()` còn rỗng. Không
// chờ thì `mount()` thấy phiên rỗng và ĐÁ VỀ `/index.html` — bản Next nhảy về
// trang chủ trong khi legacy ở nguyên trang.
import type { Metadata } from 'next';

export const metadata: Metadata = {
  // Byte-faithful với <title> của bản legacy
  title: 'Thi thử Full Test 4 kỹ năng — Aver Learning',
  robots: { index: false, follow: false },
};

// NGÂN SÁCH CHỜ KHỚP KHUNG: `auth-provider.tsx` và `when-global-ready.mjs` đều
// cho 10s. Hạn chặt hơn khung là tự tạo lỗi giả trên mạng chậm (bot bắt ở #958).
// PHẢI CHỜ REACT HYDRATE XONG rồi mới cho mã legacy đụng DOM. Script kiểu module
// chạy TRƯỚC `DOMContentLoaded`; nếu lúc đó điều kiện đã sẵn sàng thì hàm mount
// chạy ngay và ĐỔI DOM trước khi React hydrate → React #418 → nó vứt HTML máy
// chủ và dựng lại từ đầu, xoá sạch thay đổi của script, trang quay về trạng thái
// ban đầu. Đã xảy ra THẬT (G1 bắt ở `/mock/result` rồi `/speaking/result`); các
// trang khác chỉ thoát vì điều kiện chưa sẵn sàng ở nhịp đầu — tức MAY.
const MOUNT = `
import { mount } from '/js/full-test.js';
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
      // HIỆN LỖI, không chỉ console.error: hết giờ mà im lặng thì học viên ngồi
      // nhìn "Đang tải…" mãi và không biết vì sao.
      console.error('[full-test] Supabase khong san sang sau 10s');
      const el = document.getElementById('state-error');
      if (el) {
        el.textContent = 'Khong tai duoc phien dang nhap. Vui long tai lai trang.';
        el.classList.remove('hidden');
        document.getElementById('state-loading')?.classList.add('hidden');
      }
    }
  }, 20);
}
`.trim();

export default function FullTestPage() {
  return (
    <>
      {/* @ts-ignore */}
      <aver-chrome active="mock" />
      <div className="ft-wrap">
        <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--av-text-primary)', marginBottom: 4 }}>
          Thi thử Full Test 4 kỹ năng
        </h1>
        <p className="ft-muted" style={{ marginBottom: 20 }}>
          Listening → Reading → Writing, giám thị mở lần lượt từng phần và mỗi phần có đồng hồ riêng; Speaking vấn đáp riêng. Bài thu kín — giám khảo chấm và trả điểm sau. Mỗi lúc chỉ làm được một kỳ thi.
        </p>

        <div id="state-loading" className="ft-muted" style={{ textAlign: 'center', padding: '40px 0' }}>Đang tải…</div>
        <div id="state-empty" className="hidden ft-card" style={{ textAlign: 'center' }}>
          <p className="ft-muted">Hiện chưa có kỳ thi nào được mở. Quay lại khi giám khảo mở kỳ nhé.</p>
        </div>
        <div id="state-error" className="hidden ft-card" style={{ textAlign: 'center', color: 'var(--av-error)' }}></div>
        <div id="exam-list" className="hidden"></div>
      </div>
      <script type="module" dangerouslySetInnerHTML={{ __html: MOUNT }} />
    </>
  );
}
