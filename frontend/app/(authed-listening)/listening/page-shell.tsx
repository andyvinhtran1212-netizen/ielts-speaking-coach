// Vỏ tĩnh của trang Listening (trang chính) — chép TRUNG THỰC từ `public/pages/listening.html`.
//
// Hành vi KHÔNG được port: `page.tsx` nạp thẳng module legacy
// `/js/listening-landing.js` — CHÍNH tệp trang legacy dùng — và module đó tìm phần tử
// theo **id**. Trang này có 7 id (exam-empty, exam-heading, landing-error, library-heading, library-lede, progress-heading, section-library); đổi tên bất kỳ chỗ nào
// là hỏng CẢ HAI bản cùng lúc.
//
// ICON LUCIDE nhúng thẳng SVG chứ không để `data-lucide`: lucide@1.17.0 tự thay
// thẻ đó khi nạp và đua với hydrate (React #418). Nội dung SVG ĐO TỪ TRANG
// LEGACY ĐANG CHẠY, không đoán — bản đoán đầu tiên sai số path/thứ tự ở 2 icon
// và phép so theo đường DOM bắt được.
//
// `<aver-chrome>` do `page.tsx` dựng, KHÔNG dựng ở đây (bài học #950: chép cả
// thẻ đó từ legacy ra hai thanh điều hướng).

export function ListeningLandingShell() {
  return (
    <div className="shell">

      {/* ── Header ────────────────────────────────────────────────── */}
      <header className="vocab-header">
        <p className="eyebrow">Listening</p>
        <h1>Luyện nghe <span className="accent">IELTS</span></h1>
        <p className="subtitle">
          Làm đề đầy đủ, luyện 1 section, hoặc khoan sâu vào đúng dạng câu hỏi
          bạn hay sai. Mỗi thẻ hiển thị số bài đang có — thẻ chưa có bài sẽ
          không xuất hiện.
        </p>
      </header>

      {/* ══ 1. Luyện theo đề ═══════════════════════════════════════════
           Everything here is backed by `listening_tests` rows that the
           list pages themselves render, so a visible card always leads to
           a populated page. Counts come from GET /api/listening/overview,
           which applies the SAME filters as the list endpoints. */}
      <section className="vocab-modes" aria-labelledby="exam-heading">
        <h2 id="exam-heading">Luyện theo đề</h2>
        <div className="modes-grid">

          {/* Full Test — Cambridge, 40 câu / 4 section */}
          <a href="/listening/tests" className="mode-card" data-mode="full-test"
             data-count-key="tests.full" hidden aria-label="Full Test">
            <div className="head">
              <div className="icon"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="lucide lucide-library"><path d="m16 6 4 14" /><path d="M12 6v14" /><path d="M8 8v12" /><path d="M4 4v16" /></svg></div>
              <span className="arrow" aria-hidden="true">→</span>
            </div>
            <h3>Full Test<span className="mode-card__badge" data-count-slot>—</span></h3>
            <p className="lede">
              Đề Cambridge đầy đủ 40 câu / 4 section, không tua lại — sát điều
              kiện phòng thi. Có chấm điểm, band ước tính và chép chính tả theo đề.
            </p>
          </a>

          {/* Mini Test — 1 section, chấm điểm + band */}
          <a href="/listening/mini-test" className="mode-card" data-mode="mini-test"
             data-count-key="tests.mini" hidden aria-label="Mini Test">
            <div className="head">
              <div className="icon"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="lucide lucide-award"><path d="m15.477 12.89 1.515 8.526a.5.5 0 0 1-.81.47l-3.58-2.687a1 1 0 0 0-1.197 0l-3.586 2.686a.5.5 0 0 1-.81-.469l1.514-8.526" /><circle cx="12" cy="8" r="6" /></svg></div>
              <span className="arrow" aria-hidden="true">→</span>
            </div>
            <h3>Mini Test<span className="mode-card__badge" data-count-slot>—</span></h3>
            <p className="lede">
              Bài ngắn 1 section — làm bài &amp; chữa bài như Full Test, chấm điểm
              + band. Hợp khi bạn chỉ có 10–15 phút.
            </p>
          </a>

          {/* Skill drills — theo từng dạng câu hỏi */}
          <a href="/listening/skills" className="mode-card" data-mode="skills-practice"
             data-count-key="tests.drill" hidden aria-label="Luyện kĩ năng">
            <div className="head">
              <div className="icon"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="lucide lucide-target"><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></svg></div>
              <span className="arrow" aria-hidden="true">→</span>
            </div>
            <h3>Luyện kĩ năng<span className="mode-card__badge" data-count-slot>—</span></h3>
            <p className="lede">
              Tập trung từng dạng bài (điền form, bản đồ, nối, trắc nghiệm…) —
              làm bài &amp; chữa bài như Mini Test.
            </p>
          </a>

          {/* Luyện nhanh — kho bài ngắn (bẫy / mô phỏng section / soạn tay).
               Một thư viện, ba tab; thẻ này đếm cả ba. */}
          <a href="/listening/practice" className="mode-card" data-mode="practice"
             data-count-key="tests.practice" hidden aria-label="Luyện nhanh">
            <div className="head">
              <div className="icon"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="lucide lucide-zap"><path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" /></svg></div>
              <span className="arrow" aria-hidden="true">→</span>
            </div>
            <h3>Luyện nhanh<span className="mode-card__badge" data-count-slot>—</span></h3>
            <p className="lede">
              Bài ngắn 30–90 giây, thông tin dày. Luyện riêng từng loại bẫy, hoặc
              đoạn mô phỏng Part 1/2/3 — làm được vài bài trong lúc chờ.
            </p>
          </a>

        </div>

        {/* Shown only when the whole section came back empty, so the page
             never renders as a bare heading over nothing. */}
        <p className="ll-empty" id="exam-empty" hidden>
          Chưa có đề nào được xuất bản. Hãy quay lại sau khi quản trị viên đăng bài mới.
        </p>
      </section>

      {/* ══ 2. Luyện tự do theo bài nghe ══════════════════════════════
           `listening_content` + `listening_exercises`. Sprint 11.2–11.5
           shipped four standalone mode pages (dictation / gist / T-F /
           MCQ), but every one of them requires a `?content_id=` and shows
           an empty state without it — so as top-level tiles they were
           dead ends. They now live behind the library, where a card can
           only offer the modes it actually has. */}
      <section className="vocab-modes" id="section-library" aria-labelledby="library-heading" hidden>
        <h2 id="library-heading">Luyện tự do theo bài nghe</h2>
        <div className="modes-grid">
          <a href="/listening/browse" className="mode-card" data-mode="browse"
             data-count-key="content" hidden aria-label="Kho bài nghe">
            <div className="head">
              <div className="icon"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="lucide lucide-headphones"><path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3" /></svg></div>
              <span className="arrow" aria-hidden="true">→</span>
            </div>
            <h3>Kho bài nghe<span className="mode-card__badge" data-count-slot>—</span></h3>
            <p className="lede" id="library-lede">
              Nghe tự do theo chủ đề, giọng và trình độ. Mỗi bài mở ra các dạng
              luyện đang có sẵn cho chính bài đó.
            </p>
          </a>
        </div>
      </section>

      {/* ══ 3. Tiến độ ════════════════════════════════════════════════ */}
      <section className="vocab-modes" aria-labelledby="progress-heading">
        <h2 id="progress-heading">Tiến độ</h2>
        <div className="modes-grid">
          <a href="/listening/analytics" className="mode-card" data-mode="analytics"
             aria-label="Thống kê">
            <div className="head">
              <div className="icon"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="lucide lucide-bar-chart-3"><path d="M3 3v16a2 2 0 0 0 2 2h16" /><path d="M18 17V9" /><path d="M13 17V5" /><path d="M8 17v-3" /></svg></div>
              <span className="arrow" aria-hidden="true">→</span>
            </div>
            <h3>Thống kê</h3>
            <p className="lede">
              Điểm theo thời gian, dạng câu hay sai và bẫy hay mắc.
            </p>
          </a>
        </div>
      </section>

      <div className="error-banner" id="landing-error" hidden></div>

    </div>
  );
}
