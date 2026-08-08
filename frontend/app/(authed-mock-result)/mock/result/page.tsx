// Trang "Kết quả thi thử" (phiếu điểm TRF) trên Next — `/mock/result`.
//
// Cùng khuôn các trang port trước: JS và CSS đã tách khỏi mã inline, CẢ HAI VẾ
// nạp chung tệp đó.
import type { Metadata } from 'next';
import HydratedSignal from '@/components/hydrated-signal';
import { watchdogScript } from '@/lib/watchdog-script';

export const metadata: Metadata = {
  // Byte-faithful với <title> của bản legacy
  title: 'Kết quả thi thử — Aver Learning',
  robots: { index: false, follow: false },
};

// PHẢI CHỜ REACT HYDRATE XONG rồi mới cho mã legacy đụng DOM.
//
// G1 bắt được: React #418 kèm `line-missing: Thiếu mã sitting.` — bản Next kẹt ở
// "Đang tải kết quả…" trong khi legacy đã hiện thông báo lỗi. Chuỗi nhân quả:
// script kiểu module chạy TRƯỚC `DOMContentLoaded`; nếu lúc đó `getSupabase()`
// đã sẵn sàng thì `mount()` chạy ngay và ĐỔI DOM trước khi React hydrate. React
// thấy DOM khác thứ máy chủ trả → #418 → nó VỨT HTML máy chủ và dựng lại từ
// đầu, xoá sạch thay đổi của script. Trang quay về trạng thái ban đầu.
//
// Sáu trang port trước dùng cùng khuôn và đang xanh, nhưng đó là MAY: chúng chỉ
// thoát vì `getSupabase()` chưa sẵn sàng ở nhịp đầu nên `mount()` rơi vào nhánh
// `setInterval` — tức đã lùi sang macrotask. Ở đây phải lùi TƯỜNG MINH, không
// dựa vào may.
const MOUNT = `
import { mount } from '/js/mock-result.js';
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
      console.error('[mock-result] Supabase khong san sang sau 10s');
      // Nhanh nay cung DOI DOM, nen no cung phai cho hydrate. Bo sot no thi
      // mot lan chunk React cham hon 10s se tai tao dung loi #418 vua sua
      // (codex bat o #1003).
      afterHydration(() => {
        const err = document.getElementById('state-error');
        const load = document.getElementById('state-loading');
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

export default function MockResultPage() {
  return (
    <>
      <HydratedSignal />
      {/* @ts-ignore */}
      <aver-chrome active="home" />

      <div className="trf-wrap">
        <div id="state-loading" className="trf-state" style={{ color: 'var(--av-text-secondary)' }}>Đang tải kết quả…</div>

        <div id="state-pending" className="hidden trf-state">
          <h1>Đang chờ giám khảo duyệt</h1>
          <p>Bài của em đã được ghi nhận. Giám khảo sẽ chấm và công bố kết quả trong thời gian cam kết —
             em sẽ thấy điểm và phần chữa bài tại đây ngay khi có.</p>
        </div>

        <div id="state-error" className="hidden trf-state trf-state--error"></div>

        <div id="state-content" className="hidden">
          <a className="trf-back" href="/home"><span aria-hidden="true">←</span> Trang chủ</a>

          <section className="trf-card" id="overall">
            <div className="trf-card__head">
              <div>
                <div className="trf-eyebrow">Phiếu kết quả thi thử · TRF</div>
                <h1 className="trf-h1">Kết quả bài thi thử của em</h1>
              </div>
              <p id="released-at" className="trf-stamp"></p>
            </div>
            <div className="trf-card__body">
              <div className="trf-ring" id="overall-ring" aria-hidden="true"><div><div>
                <b id="overall-val">—</b><span>Overall</span>
              </div></div></div>
              <div className="trf-skills" id="bands"></div>
            </div>
            <div className="trf-card__foot"><span id="overall-sub"></span> · thang IELTS 0–9, giám khảo xác nhận từng kỹ năng</div>
          </section>
          {/* What the student must DO. Sits right under the bands, above the
              commentary: it used to live inside the no-band warning cards, so a
              skill that scored fine but was flagged showed nothing at all. */}
          <section id="retest-wrap" className="trf-section hidden"></section>

          <section id="comment-wrap" className="trf-section">
            <h2 className="trf-h2">Nhận xét của giám khảo</h2>
            <div id="examiner-comment" className="trf-box"></div>
          </section>

          <section id="notes-wrap" className="trf-section hidden"></section>

          <section id="chuabai-wrap" className="trf-section hidden"></section>
          {/* Why a skill has no band / no chữa bài. Both sit AFTER the review cards
              so the student sees what they DID get before what they didn't. */}
          <section id="lr-gap-wrap" className="trf-section hidden"></section>
          <section id="writing-gap-wrap" className="trf-section hidden"></section>

          <p className="trf-foot">Kết quả do giám khảo duyệt, có tham khảo phân tích AI.</p>
        </div>
      </div>
      {/* Duong lui chung mot nguon voi 11 trang kia: xem lib/watchdog-script.ts */}
      <script dangerouslySetInnerHTML={{ __html: watchdogScript('/pages/mock-result.html') }} />
      <script type="module" dangerouslySetInnerHTML={{ __html: MOUNT }} />
    </>
  );
}
