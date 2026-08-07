// Trang "Kết quả thi thử" (phiếu điểm TRF) trên Next — `/mock/result`.
//
// Cùng khuôn các trang port trước: JS và CSS đã tách khỏi mã inline, CẢ HAI VẾ
// nạp chung tệp đó.
import type { Metadata } from 'next';

export const metadata: Metadata = {
  // Byte-faithful với <title> của bản legacy
  title: 'Kết quả thi thử — Aver Learning',
  robots: { index: false, follow: false },
};

const MOUNT = `
import { mount } from '/js/mock-result.js';
const ready = () => typeof window.getSupabase === 'function' && !!window.getSupabase();
if (ready()) mount();
else {
  let n = 0;
  const iv = setInterval(() => {
    if (ready()) { clearInterval(iv); mount(); }
    else if (++n > 500) {  // 500 x 20ms = 10s
      clearInterval(iv);
      console.error('[mock-result] Supabase khong san sang sau 10s');
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

export default function MockResultPage() {
  return (
    <>
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
      <script type="module" dangerouslySetInnerHTML={{ __html: MOUNT }} />
    </>
  );
}
