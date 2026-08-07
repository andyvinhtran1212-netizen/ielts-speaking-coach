// Trang "Nhận xét Speaking" trên Next — `/speaking/result`.
//
// Cùng khuôn ba trang port trước: JS và CSS đã tách khỏi mã inline, CẢ HAI VẾ
// nạp chung tệp đó. Không chép một dòng logic nào sang React.
import type { Metadata } from 'next';
import HydratedSignal from '@/components/hydrated-signal';

export const metadata: Metadata = {
  // Byte-faithful với <title> của bản legacy
  title: 'Nhận xét Speaking — Aver Learning',
  robots: { index: false, follow: false },
};

// Chờ Supabase sẵn sàng, ngân sách 10s khớp khung. Hết giờ thì HIỆN LỖI chứ
// không chỉ `console.error` — im lặng thì học viên ngồi nhìn "Đang tải nhận
// xét…" mãi.
// PHẢI CHỜ REACT HYDRATE XONG rồi mới cho mã legacy đụng DOM. Script kiểu module
// chạy TRƯỚC `DOMContentLoaded`; nếu lúc đó điều kiện đã sẵn sàng thì hàm mount
// chạy ngay và ĐỔI DOM trước khi React hydrate → React #418 → nó vứt HTML máy
// chủ và dựng lại từ đầu, xoá sạch thay đổi của script, trang quay về trạng thái
// ban đầu. Đã xảy ra THẬT (G1 bắt ở `/mock/result` rồi `/speaking/result`); các
// trang khác chỉ thoát vì điều kiện chưa sẵn sàng ở nhịp đầu — tức MAY.
const MOUNT = `
import { mount } from '/js/speaking-result.js';
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
};
const ready = () => typeof window.getSupabase === 'function' && !!window.getSupabase();
if (ready()) afterHydration(mount);
else {
  let n = 0;
  const iv = setInterval(() => {
    if (ready()) { clearInterval(iv); afterHydration(mount); }
    else if (++n > 500) {  // 500 x 20ms = 10s
      clearInterval(iv);
      console.error('[speaking-result] Supabase khong san sang sau 10s');
      const err = document.getElementById('state-error');
      const load = document.getElementById('state-loading');
      if (err) {
        err.textContent = 'Khong tai duoc phien dang nhap. Vui long tai lai trang.';
        err.classList.remove('hidden');
      }
      if (load) load.classList.add('hidden');
    }
  }, 20);
}
`.trim();

export default function SpeakingResultPage() {
  return (
    <>
      <HydratedSignal />
      {/* @ts-ignore */}
      <aver-chrome active="home" />

      <div className="spr-wrap">
        <div id="state-loading" className="spr-state">Đang tải nhận xét…</div>
        <div id="state-error" className="spr-state spr-state--error hidden"></div>
        <div id="state-content" className="hidden">
          <a className="spr-back" id="back-link" href="#">← Về trang kết quả</a>
          <div className="spr-eyebrow">Speaking · thi trực tiếp với giáo viên</div>
          <h1 className="spr-h1">Nhận xét chi tiết của giáo viên chấm</h1>
          <div className="spr-meta" id="spr-meta"></div>
          <div id="spr-body"></div>
        </div>
      </div>
      <script type="module" dangerouslySetInnerHTML={{ __html: MOUNT }} />
    </>
  );
}
