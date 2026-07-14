import { Metadata } from 'next';
import { LandingBehavior } from './landing-behavior';

export const metadata: Metadata = {
  title: 'averlearning — Luyện IELTS toàn diện cùng AI',
  description:
    '6 kỹ năng IELTS — Speaking, Writing, Reading, Listening, Grammar và Từ vựng — trên một nền tảng. Phản hồi chi tiết theo từng tiêu chí sau mỗi buổi luyện.',
};

export default function LandingPreviewPage() {
  return (
    <div className="av-page font-sans antialiased">
      {/* ─── NAVBAR ─────────────────────────────────────────────────── */}
      <nav className="ix-nav fixed top-0 inset-x-0 z-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          {/* Logo */}
          <a href="#" className="ix-logo flex items-center gap-2">
            <div className="ix-logo__mark w-8 h-8 rounded-lg flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-5 h-5" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z" />
              </svg>
            </div>
            <span className="ix-logo__text font-bold text-lg tracking-tight">
              averlearning
            </span>
          </a>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-8">
            <a href="/grammar.html" className="ix-nav-link text-sm font-medium pb-1">
              Grammar Wiki
            </a>
            <a href="#features" className="ix-nav-link text-sm font-medium pb-1">
              Tính năng
            </a>
          </div>

          {/* CTA buttons */}
          <div className="flex items-center gap-3">
            <a
              href="/login.html"
              className="ix-nav-signin hidden sm:inline-flex text-sm font-medium px-3 py-2"
            >
              Đăng nhập
            </a>
            <a
              href="/login.html"
              className="ix-nav-cta inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-lg"
            >
              Dùng thử miễn phí
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M13 7l5 5m0 0l-5 5m5-5H6"
                />
              </svg>
            </a>
            <button
              className="av-theme-toggle"
              type="button"
              aria-label="Chuyển giao diện sáng/tối"
            >
              <svg className="icon-sun" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
              </svg>
              <svg className="icon-moon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            </button>
          </div>
        </div>
      </nav>

      {/* ─── HERO ──────────────────────────────────────────────────── */}
      <section className="ix-hero relative overflow-hidden pt-28 pb-20 md:pt-36 md:pb-28">
        <div className="ix-hero__glow absolute inset-0 pointer-events-none" />

        <div className="ix-hero__grid absolute inset-0 pointer-events-none" />

        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            {/* Left: Copy */}
            <div>
              <div className="ix-hero__eyebrow inline-flex items-center gap-2 rounded-full px-4 py-1.5 mb-6">
                <span className="ix-hero__eyebrow-dot w-2 h-2 rounded-full animate-pulse" />
                <span className="ix-hero__eyebrow-text text-sm font-medium">
                  Nền tảng luyện thi IELTS toàn diện
                </span>
              </div>

              <h1 className="ix-hero__title text-4xl sm:text-5xl lg:text-6xl font-extrabold leading-[1.1] tracking-tight mb-6">
                Luyện thi IELTS toàn diện
                <br />
                <span className="ix-hero__title-accent">cùng AI Coach.</span>
              </h1>

              <p className="ix-hero__lead text-lg leading-relaxed mb-8 max-w-lg">
                6 kỹ năng IELTS — Speaking, Writing, Reading, Listening, Grammar
                và Từ vựng — trên một nền tảng. Phản hồi chi tiết theo từng tiêu
                chí sau mỗi buổi luyện. Không chung chung, không chờ đợi.
              </p>

              <div className="flex flex-col sm:flex-row gap-4">
                <a
                  href="/login.html"
                  className="ix-cta-light inline-flex items-center justify-center gap-2 font-bold px-6 py-3.5 rounded-xl text-base"
                >
                  Bắt đầu miễn phí
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M13 7l5 5m0 0l-5 5m5-5H6"
                    />
                  </svg>
                </a>
                <a
                  href="#how-it-works"
                  className="ix-cta-ghost inline-flex items-center justify-center gap-2 font-semibold px-6 py-3.5 rounded-xl text-base"
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  Xem cách hoạt động
                </a>
              </div>

              <p className="ix-hero__note mt-5 text-sm">
                Đăng ký miễn phí · Kích hoạt bằng access code từ lớp/trung tâm
              </p>
            </div>

            {/* Right: 6-skill mosaic */}
            <div className="hidden lg:block">
              <div className="ix-skill-mosaic">
                <div
                  className="ix-skill-mosaic__card"
                  style={{
                    '--card-color': 'var(--av-accent)',
                    '--card-tilt': '-0.6deg',
                  } as React.CSSProperties}
                >
                  <div className="ix-skill-mosaic__icon-wrap">🎙</div>
                  <div className="ix-skill-mosaic__text">
                    <p className="ix-skill-mosaic__name">Speaking</p>
                    <p className="ix-skill-mosaic__sub">
                      Part 1, 2, 3 · Full Test
                    </p>
                  </div>
                  <span className="ix-skill-mosaic__chip">AI Coach</span>
                </div>
                <div
                  className="ix-skill-mosaic__card"
                  style={{
                    '--card-color': 'var(--av-primary)',
                    '--card-tilt': '0.5deg',
                  } as React.CSSProperties}
                >
                  <div className="ix-skill-mosaic__icon-wrap">✍</div>
                  <div className="ix-skill-mosaic__text">
                    <p className="ix-skill-mosaic__name">Writing</p>
                    <p className="ix-skill-mosaic__sub">Task 1 &amp; 2 · Gemini AI</p>
                  </div>
                  <span className="ix-skill-mosaic__chip">AI Grader</span>
                </div>
                <div
                  className="ix-skill-mosaic__card"
                  style={{
                    '--card-color': 'var(--av-skill-reading)',
                    '--card-tilt': '0.4deg',
                  } as React.CSSProperties}
                >
                  <div className="ix-skill-mosaic__icon-wrap">✸</div>
                  <div className="ix-skill-mosaic__text">
                    <p className="ix-skill-mosaic__name">Reading</p>
                    <p className="ix-skill-mosaic__sub">
                      Bài đọc chính hãng IELTS
                    </p>
                  </div>
                  <span className="ix-skill-mosaic__chip">Active</span>
                </div>
                <div
                  className="ix-skill-mosaic__card"
                  style={{
                    '--card-color': 'var(--av-skill-listening)',
                    '--card-tilt': '-0.4deg',
                  } as React.CSSProperties}
                >
                  <div className="ix-skill-mosaic__icon-wrap">◐</div>
                  <div className="ix-skill-mosaic__text">
                    <p className="ix-skill-mosaic__name">Listening</p>
                    <p className="ix-skill-mosaic__sub">Dictation · Note-taking</p>
                  </div>
                  <span className="ix-skill-mosaic__chip">Active</span>
                </div>
                <div
                  className="ix-skill-mosaic__card"
                  style={{
                    '--card-color': 'var(--av-skill-grammar)',
                    '--card-tilt': '0.5deg',
                  } as React.CSSProperties}
                >
                  <div className="ix-skill-mosaic__icon-wrap">✦</div>
                  <div className="ix-skill-mosaic__text">
                    <p className="ix-skill-mosaic__name">Grammar</p>
                    <p className="ix-skill-mosaic__sub">67 bài học · Roadmap</p>
                  </div>
                  <span className="ix-skill-mosaic__chip">Wiki</span>
                </div>
                <div
                  className="ix-skill-mosaic__card"
                  style={{
                    '--card-color': 'var(--av-vocab-jade)',
                    '--card-tilt': '-0.5deg',
                  } as React.CSSProperties}
                >
                  <div className="ix-skill-mosaic__icon-wrap">⌗</div>
                  <div className="ix-skill-mosaic__text">
                    <p className="ix-skill-mosaic__name">Từ vựng</p>
                    <p className="ix-skill-mosaic__sub">
                      SRS · Flashcard · Wallet
                    </p>
                  </div>
                  <span className="ix-skill-mosaic__chip">SRS</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── SOCIAL PROOF BAR ──────────────────────────────────────── */}
      <section className="ix-stats-bar">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <div className="grid grid-cols-3 gap-8 text-center">
            <div>
              <p className="ix-stat__num text-4xl font-extrabold">
                <span data-stat="total_users">—</span>
              </p>
              <p className="ix-stat__label text-sm mt-1 font-medium">
                Học viên đăng ký
              </p>
            </div>
            <div className="ix-stat--bordered">
              <p className="ix-stat__num text-4xl font-extrabold">
                <span data-stat="sessions_completed">—</span>
              </p>
              <p className="ix-stat__label text-sm mt-1 font-medium">
                Buổi luyện đã hoàn thành
              </p>
            </div>
            <div>
              <p className="ix-stat__num text-4xl font-extrabold">6</p>
              <p className="ix-stat__label text-sm mt-1 font-medium">
                Kỹ năng IELTS trên một nền tảng
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ─── FEATURES ──────────────────────────────────────────────── */}
      <section id="features" className="ix-section-sunken py-20 md:py-28">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <span className="ix-eyebrow inline-block text-sm font-bold uppercase tracking-widest mb-3">
              Tính năng
            </span>
            <h2 className="ix-heading text-3xl sm:text-4xl font-extrabold leading-tight">
              6 kỹ năng IELTS,
              <br />
              một nền tảng
            </h2>
            <p className="ix-subtitle mt-4 max-w-xl mx-auto text-lg leading-relaxed">
              Speaking và Writing chấm bằng AI, Reading và Listening chính hãng,
              từ vựng SRS thông minh và Grammar Wiki tra cứu nhanh — đủ để bạn
              luyện trọn vẹn mỗi ngày.
            </p>
          </div>

          <div className="ix-skill-grid grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Speaking */}
            <article className="ix-skill-card" data-skill="speaking">
              <div className="ix-skill-card__icon">
                <i data-lucide="mic" />
              </div>
              <p className="ix-skill-card__eyebrow">AI Coach realtime</p>
              <h3 className="ix-skill-card__title">Speaking</h3>
              <p className="ix-skill-card__body">
                Luyện Part 1, 2, 3 và Full Test cùng AI Claude — phản hồi sau mỗi
                câu trả lời về phát âm, lưu loát, từ vựng, ngữ pháp.
              </p>
              <ul className="ix-skill-card__feats">
                <li>4 chế độ luyện: Part 1, 2, 3, Full Test</li>
                <li>Chấm 4 tiêu chí: FC · LR · GRA · P</li>
                <li>Lịch sử band và tiến độ theo tuần</li>
              </ul>
              <a href="/login.html" className="ix-skill-card__cta">
                Bắt đầu luyện Speaking
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M13 7l5 5m0 0l-5 5m5-5H6"
                  />
                </svg>
              </a>
            </article>

            {/* Writing */}
            <article
              className="ix-skill-card ix-skill-card--popular"
              data-skill="writing"
            >
              <span className="ix-skill-card__badge">Nổi bật</span>
              <div className="ix-skill-card__icon">
                <i data-lucide="pencil-line" />
              </div>
              <p className="ix-skill-card__eyebrow">AI Grader Gemini</p>
              <h3 className="ix-skill-card__title">Writing</h3>
              <p className="ix-skill-card__body">
                Task 1 (Academic + General Training) và Task 2 chấm chi tiết bằng
                Gemini 2.5 Pro — chỉ ra đúng lỗi câu, gợi ý sửa cụ thể.
              </p>
              <ul className="ix-skill-card__feats">
                <li>Academic + General Training</li>
                <li>Chấm 4 tiêu chí IELTS chuẩn</li>
                <li>Feedback từng câu, không chung chung</li>
              </ul>
              <a href="/login.html" className="ix-skill-card__cta">
                Bắt đầu luyện Writing
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M13 7l5 5m0 0l-5 5m5-5H6"
                  />
                </svg>
              </a>
            </article>

            {/* Reading */}
            <article className="ix-skill-card" data-skill="reading">
              <div className="ix-skill-card__icon">
                <i data-lucide="book-marked" />
              </div>
              <p className="ix-skill-card__eyebrow">Bài đọc chính hãng IELTS</p>
              <h3 className="ix-skill-card__title">Reading</h3>
              <p className="ix-skill-card__body">
                Bài đọc IELTS thực tế với phân tích cấu trúc đoạn, chiến lược tìm
                ý chính và phân tích bẫy câu hỏi.
              </p>
              <ul className="ix-skill-card__feats">
                <li>Passage-level và question-level</li>
                <li>True/False, Matching, Fill-in</li>
                <li>Phân tích chiến lược đọc hiểu</li>
              </ul>
              <a href="/login.html" className="ix-skill-card__cta">
                Bắt đầu luyện Reading
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M13 7l5 5m0 0l-5 5m5-5H6"
                  />
                </svg>
              </a>
            </article>

            {/* Listening */}
            <article className="ix-skill-card" data-skill="listening">
              <div className="ix-skill-card__icon">
                <i data-lucide="headphones" />
              </div>
              <p className="ix-skill-card__eyebrow">Audio thực tế IELTS</p>
              <h3 className="ix-skill-card__title">Listening</h3>
              <p className="ix-skill-card__body">
                Dictation, note-taking và phân tích bẫy đáp án — rèn kỹ năng nghe
                toàn diện từ cơ bản đến nâng cao.
              </p>
              <ul className="ix-skill-card__feats">
                <li>Section 1–4 theo chuẩn IELTS</li>
                <li>Dictation và note-taking</li>
                <li>Phân tích bẫy đáp án phổ biến</li>
              </ul>
              <a href="/login.html" className="ix-skill-card__cta">
                Bắt đầu luyện Listening
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M13 7l5 5m0 0l-5 5m5-5H6"
                  />
                </svg>
              </a>
            </article>

            {/* Vocabulary */}
            <article className="ix-skill-card" data-skill="vocabulary">
              <div className="ix-skill-card__icon">
                <i data-lucide="library" />
              </div>
              <p className="ix-skill-card__eyebrow">SRS thông minh</p>
              <h3 className="ix-skill-card__title">Từ vựng</h3>
              <p className="ix-skill-card__body">
                Flashcards lặp lại theo lịch tự động, tự thêm từ vựng sau mỗi
                buổi Speaking, exercises ôn tập theo chủ đề.
              </p>
              <ul className="ix-skill-card__feats">
                <li>SRS rating: Quên · Khó · Dễ · Đã thuộc</li>
                <li>Tự lưu từ "used well" sau buổi Speaking</li>
                <li>Exercises ôn tập theo chủ đề</li>
              </ul>
              <a href="/login.html" className="ix-skill-card__cta">
                Khám phá từ vựng
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M13 7l5 5m0 0l-5 5m5-5H6"
                  />
                </svg>
              </a>
            </article>

            {/* Grammar Wiki */}
            <article className="ix-skill-card" data-skill="grammar">
              <div className="ix-skill-card__icon">
                <i data-lucide="book-open" />
              </div>
              <p className="ix-skill-card__eyebrow">Roadmap · Articles</p>
              <h3 className="ix-skill-card__title">Grammar Wiki</h3>
              <p className="ix-skill-card__body">
                Roadmap ngữ pháp IELTS theo bước, thư viện articles tra cứu nhanh,
                công cụ so sánh các điểm ngữ pháp dễ nhầm.
              </p>
              <ul className="ix-skill-card__feats">
                <li>Curriculum roadmap có thứ tự</li>
                <li>Articles tra cứu cho Speaking &amp; Writing</li>
                <li>So sánh các cấu trúc dễ nhầm</li>
              </ul>
              <a href="/grammar.html" className="ix-skill-card__cta">
                Mở Grammar Wiki
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M13 7l5 5m0 0l-5 5m5-5H6"
                  />
                </svg>
              </a>
            </article>
          </div>
        </div>
      </section>

      {/* ─── HOW IT WORKS ──────────────────────────────────────────── */}
      <section id="how-it-works" className="ix-section py-20 md:py-28">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <span className="ix-eyebrow inline-block text-sm font-bold uppercase tracking-widest mb-3">
              Cách hoạt động
            </span>
            <h2 className="ix-heading text-3xl sm:text-4xl font-extrabold">
              3 bước đơn giản
            </h2>
            <p className="ix-subtitle mt-4 max-w-lg mx-auto text-lg">
              Từ đăng ký đến buổi luyện đầu tiên — Speaking, Writing, Từ vựng hay
              Grammar — chỉ trong vài phút.
            </p>
          </div>

          <div className="relative grid md:grid-cols-3 gap-10">
            {/* Connector line (desktop) */}
            <div className="ix-step-line hidden md:block absolute top-12 left-1/4 right-1/4 h-0.5" />
            <div className="ix-step-line ix-step-line--right hidden md:block absolute top-12 h-0.5" />

            {/* Step 1 */}
            <div className="relative text-center">
              <div className="ix-step__icon ix-step__icon--alt w-24 h-24 rounded-2xl flex flex-col items-center justify-center mx-auto mb-6">
                <span className="ix-step__label text-xs font-bold uppercase tracking-widest mb-1">
                  Bước 1
                </span>
                <svg
                  className="w-8 h-8"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                  />
                </svg>
              </div>
              <h3 className="ix-step__title text-xl font-bold mb-3">
                Tạo tài khoản
              </h3>
              <p className="ix-step__body leading-relaxed max-w-xs mx-auto">
                Đăng ký miễn phí bằng email hoặc Google, rồi kích hoạt bằng access
                code từ lớp hoặc trung tâm của bạn.
              </p>
            </div>

            {/* Step 2 */}
            <div className="relative text-center">
              <div className="ix-step__icon w-24 h-24 rounded-2xl flex flex-col items-center justify-center mx-auto mb-6">
                <span className="ix-step__label ix-step__label--on-primary text-xs font-bold uppercase tracking-widest mb-1">
                  Bước 2
                </span>
                <svg
                  className="w-8 h-8"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
                  />
                </svg>
              </div>
              <h3 className="ix-step__title text-xl font-bold mb-3">
                Chọn kỹ năng và luyện
              </h3>
              <p className="ix-step__body leading-relaxed max-w-xs mx-auto">
                Chọn 1 trong 6 kỹ năng IELTS. Mỗi buổi luyện được AI chấm theo
                đúng tiêu chí IELTS thực tế.
              </p>
            </div>

            {/* Step 3 */}
            <div className="relative text-center">
              <div className="ix-step__icon ix-step__icon--alt w-24 h-24 rounded-2xl flex flex-col items-center justify-center mx-auto mb-6">
                <span className="ix-step__label text-xs font-bold uppercase tracking-widest mb-1">
                  Bước 3
                </span>
                <svg
                  className="w-8 h-8"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                  />
                </svg>
              </div>
              <h3 className="ix-step__title text-xl font-bold mb-3">
                Theo dõi tiến độ
              </h3>
              <p className="ix-step__body leading-relaxed max-w-xs mx-auto">
                Lịch sử band Speaking, bài Writing đã chấm, từ vựng đã thuộc và các
                điểm ngữ pháp cần ôn — tất cả ở một chỗ.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ─── PRICING (hidden pre-launch) ───────────────────────────── */}
      <section
        id="pricing"
        className="ix-section-sunken py-20 md:py-28"
        style={{ display: 'none' }}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <span className="ix-eyebrow inline-block text-sm font-bold uppercase tracking-widest mb-3">
              Bảng giá
            </span>
            <h2 className="ix-heading text-3xl sm:text-4xl font-extrabold">
              Bắt đầu miễn phí,
              <br />
              nâng cấp khi sẵn sàng
            </h2>
            <p className="ix-subtitle mt-4 max-w-lg mx-auto text-lg">
              Không có cam kết dài hạn. Huỷ bất kỳ lúc nào.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {/* Free tier */}
            <div className="ix-price-card rounded-2xl p-8 flex flex-col">
              <div className="mb-6">
                <p className="ix-price-card__tier text-sm font-bold uppercase tracking-widest mb-2">
                  Miễn phí
                </p>
                <p className="ix-price-card__amount text-4xl font-extrabold">
                  0<span className="ix-price-card__unit text-xl font-normal">đ</span>
                </p>
                <p className="ix-price-card__period text-sm mt-1">mãi mãi</p>
              </div>
              <ul className="space-y-3 flex-1 mb-8">
                <li className="ix-price-card__feat flex items-start gap-2.5 text-sm">
                  <svg
                    className="ix-price-card__check w-4 h-4 flex-shrink-0 mt-0.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2.5"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  3 buổi luyện mỗi ngày
                </li>
                <li className="ix-price-card__feat flex items-start gap-2.5 text-sm">
                  <svg
                    className="ix-price-card__check w-4 h-4 flex-shrink-0 mt-0.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2.5"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  Part 1, 2, 3
                </li>
                <li className="ix-price-card__feat flex items-start gap-2.5 text-sm">
                  <svg
                    className="ix-price-card__check w-4 h-4 flex-shrink-0 mt-0.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2.5"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  Phản hồi AI cơ bản
                </li>
                <li className="ix-price-card__feat ix-price-card__feat--off flex items-start gap-2.5 text-sm">
                  <svg
                    className="ix-price-card__cross w-4 h-4 flex-shrink-0 mt-0.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2.5"
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                  Chấm điểm phát âm
                </li>
                <li className="ix-price-card__feat ix-price-card__feat--off flex items-start gap-2.5 text-sm">
                  <svg
                    className="ix-price-card__cross w-4 h-4 flex-shrink-0 mt-0.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2.5"
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                  Full Test mode
                </li>
              </ul>
              <a href="/login.html" className="ix-price-card__cta block text-center font-bold py-3 rounded-xl">
                Bắt đầu miễn phí
              </a>
            </div>

            {/* Student tier (popular) */}
            <div className="ix-price-card ix-price-card--popular rounded-2xl p-8 flex flex-col relative overflow-hidden">
              <div className="ix-price-card__ribbon absolute top-0 right-0 text-xs font-bold px-4 py-1.5 rounded-bl-xl">
                Phổ biến nhất
              </div>
              <div className="mb-6">
                <p className="ix-price-card__tier ix-price-card__tier--on-primary text-sm font-bold uppercase tracking-widest mb-2">
                  Học viên
                </p>
                <p className="ix-price-card__amount ix-price-card__amount--on-primary text-4xl font-extrabold">
                  299K
                  <span className="ix-price-card__unit ix-price-card__unit--on-primary text-xl font-normal">
                    /tháng
                  </span>
                </p>
                <p className="ix-price-card__period ix-price-card__period--on-primary text-sm mt-1">
                  tương đương 10K/ngày
                </p>
              </div>
              <ul className="space-y-3 flex-1 mb-8">
                <li className="ix-price-card__feat ix-price-card__feat--on-primary flex items-start gap-2.5 text-sm">
                  <svg
                    className="ix-price-card__check ix-price-card__check--on-primary w-4 h-4 flex-shrink-0 mt-0.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2.5"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  Không giới hạn buổi luyện
                </li>
                <li className="ix-price-card__feat ix-price-card__feat--on-primary flex items-start gap-2.5 text-sm">
                  <svg
                    className="ix-price-card__check ix-price-card__check--on-primary w-4 h-4 flex-shrink-0 mt-0.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2.5"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  Phản hồi AI chi tiết đầy đủ
                </li>
                <li className="ix-price-card__feat ix-price-card__feat--on-primary flex items-start gap-2.5 text-sm">
                  <svg
                    className="ix-price-card__check ix-price-card__check--on-primary w-4 h-4 flex-shrink-0 mt-0.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2.5"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  Chấm điểm phát âm
                </li>
                <li className="ix-price-card__feat ix-price-card__feat--on-primary flex items-start gap-2.5 text-sm">
                  <svg
                    className="ix-price-card__check ix-price-card__check--on-primary w-4 h-4 flex-shrink-0 mt-0.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2.5"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  Full Test mode (3 parts)
                </li>
                <li className="ix-price-card__feat ix-price-card__feat--on-primary flex items-start gap-2.5 text-sm">
                  <svg
                    className="ix-price-card__check ix-price-card__check--on-primary w-4 h-4 flex-shrink-0 mt-0.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2.5"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  Grammar Wiki đầy đủ
                </li>
              </ul>
              <a href="/login.html" className="ix-price-card__cta ix-price-card__cta--popular block text-center font-bold py-3 rounded-xl">
                Chọn gói này
              </a>
            </div>

            {/* Intensive tier */}
            <div className="ix-price-card rounded-2xl p-8 flex flex-col">
              <div className="mb-6">
                <p className="ix-price-card__tier text-sm font-bold uppercase tracking-widest mb-2">
                  Luyện thi cấp tốc
                </p>
                <p className="ix-price-card__amount text-4xl font-extrabold">
                  699K
                  <span className="ix-price-card__unit text-xl font-normal">
                    /tháng
                  </span>
                </p>
                <p className="ix-price-card__period text-sm mt-1">
                  cho kỳ thi gần nhất
                </p>
              </div>
              <ul className="space-y-3 flex-1 mb-8">
                <li className="ix-price-card__feat flex items-start gap-2.5 text-sm">
                  <svg
                    className="ix-price-card__check w-4 h-4 flex-shrink-0 mt-0.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2.5"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  Tất cả tính năng Học viên
                </li>
                <li className="ix-price-card__feat flex items-start gap-2.5 text-sm">
                  <svg
                    className="ix-price-card__check w-4 h-4 flex-shrink-0 mt-0.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2.5"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  Đề thi theo chủ đề mục tiêu
                </li>
                <li className="ix-price-card__feat flex items-start gap-2.5 text-sm">
                  <svg
                    className="ix-price-card__check w-4 h-4 flex-shrink-0 mt-0.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2.5"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  Phân tích tiến độ theo tuần
                </li>
                <li className="ix-price-card__feat flex items-start gap-2.5 text-sm">
                  <svg
                    className="ix-price-card__check w-4 h-4 flex-shrink-0 mt-0.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2.5"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  Ưu tiên hỗ trợ kỹ thuật
                </li>
              </ul>
              <a href="/login.html" className="ix-price-card__cta block text-center font-bold py-3 rounded-xl">
                Chọn gói này
              </a>
            </div>
          </div>

          <p className="ix-price-note text-center mt-8 text-sm">
            Giá hiển thị là dự kiến — xem chi tiết tại{' '}
            <a href="/pricing.html" className="ix-price-note__link underline underline-offset-2">
              trang bảng giá
            </a>
            .
          </p>
        </div>
      </section>

      {/* ─── TESTIMONIALS ──────────────────────────────────────────── */}
      <section className="ix-section py-20 md:py-28">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <span className="ix-eyebrow inline-block text-sm font-bold uppercase tracking-widest mb-3">
              Học viên nói gì
            </span>
            <h2 className="ix-heading text-3xl sm:text-4xl font-extrabold">
              Kết quả thực tế
            </h2>
          </div>

          <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
            {/* Testimonial 1 */}
            <div className="ix-testimonial rounded-2xl p-8 relative">
              <div
                className="ix-testimonial__quote absolute top-4 left-6 select-none"
                aria-hidden="true"
              >
                "
              </div>
              <div className="relative">
                <p className="ix-testimonial__body leading-relaxed mb-6 text-base italic">
                  "Mình luyện mỗi tối khoảng 30 phút, sau 6 tuần điểm Speaking tăng
                  từ 6.0 lên 7.0. Điều mình thích nhất là phần nhận xét phát âm —
                  nó chỉ ra đúng những từ mình phát âm sai mà mình không tự nhận
                  ra."
                </p>
                <div className="flex items-center gap-3">
                  <div className="ix-testimonial__avatar ix-testimonial__avatar--alt w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0">
                    NT
                  </div>
                  <div>
                    <p className="ix-testimonial__name font-bold text-sm">
                      Nguyễn Thanh
                    </p>
                    <p className="ix-testimonial__meta text-xs">
                      Band 7.0 Speaking · Hà Nội
                    </p>
                  </div>
                  <div className="ml-auto flex gap-0.5">
                    <svg
                      className="ix-testimonial__star w-4 h-4 fill-current"
                      viewBox="0 0 20 20"
                    >
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                    <svg
                      className="ix-testimonial__star w-4 h-4 fill-current"
                      viewBox="0 0 20 20"
                    >
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                    <svg
                      className="ix-testimonial__star w-4 h-4 fill-current"
                      viewBox="0 0 20 20"
                    >
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                    <svg
                      className="ix-testimonial__star w-4 h-4 fill-current"
                      viewBox="0 0 20 20"
                    >
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                    <svg
                      className="ix-testimonial__star w-4 h-4 fill-current"
                      viewBox="0 0 20 20"
                    >
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                  </div>
                </div>
              </div>
            </div>

            {/* Testimonial 2 */}
            <div className="ix-testimonial rounded-2xl p-8 relative">
              <div
                className="ix-testimonial__quote absolute top-4 left-6 select-none"
                aria-hidden="true"
              >
                "
              </div>
              <div className="relative">
                <p className="ix-testimonial__body leading-relaxed mb-6 text-base italic">
                  "Trước kia mình ngại nói vì sợ mắc lỗi. Giờ luyện với AI mình
                  không còn sợ vì biết rõ mình cần cải thiện gì. Phần phản hồi ngữ
                  pháp rất cụ thể, không bị chung chung như các app khác."
                </p>
                <div className="flex items-center gap-3">
                  <div className="ix-testimonial__avatar w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0">
                    LA
                  </div>
                  <div>
                    <p className="ix-testimonial__name font-bold text-sm">Lê Anh</p>
                    <p className="ix-testimonial__meta text-xs">
                      Band 6.5 Speaking · TP.HCM
                    </p>
                  </div>
                  <div className="ml-auto flex gap-0.5">
                    <svg
                      className="ix-testimonial__star w-4 h-4 fill-current"
                      viewBox="0 0 20 20"
                    >
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                    <svg
                      className="ix-testimonial__star w-4 h-4 fill-current"
                      viewBox="0 0 20 20"
                    >
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                    <svg
                      className="ix-testimonial__star w-4 h-4 fill-current"
                      viewBox="0 0 20 20"
                    >
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                    <svg
                      className="ix-testimonial__star w-4 h-4 fill-current"
                      viewBox="0 0 20 20"
                    >
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                    <svg
                      className="ix-testimonial__star w-4 h-4 fill-current"
                      viewBox="0 0 20 20"
                    >
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── CTA ───────────────────────────────────────────────────── */}
      <section className="ix-hero ix-hero--cta py-20 md:py-28 relative overflow-hidden">
        <div className="ix-hero__glow absolute inset-0 pointer-events-none" />
        <div className="ix-hero__grid absolute inset-0 pointer-events-none" />
        <div className="relative max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="ix-hero__title text-3xl sm:text-5xl font-extrabold leading-tight mb-6">
            Sẵn sàng bắt đầu
            <br />
            hành trình IELTS?
          </h2>
          <p className="ix-hero__lead text-lg mb-10 max-w-xl mx-auto leading-relaxed">
            6 kỹ năng, một nền tảng, phản hồi AI tức thì. Kích hoạt bằng access
            code từ lớp/trung tâm để bắt đầu.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href="/login.html"
              className="ix-cta-light inline-flex items-center justify-center gap-2 font-bold px-8 py-4 rounded-xl text-lg"
            >
              Dùng thử miễn phí ngay
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M13 7l5 5m0 0l-5 5m5-5H6"
                />
              </svg>
            </a>
            <a
              href="/login.html"
              className="ix-cta-ghost inline-flex items-center justify-center gap-2 font-semibold px-8 py-4 rounded-xl text-lg"
            >
              Đăng nhập
            </a>
          </div>
        </div>
      </section>

      {/* ─── FOOTER ────────────────────────────────────────────────── */}
      <footer className="ix-footer py-12">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-4 gap-8 mb-10">
            {/* Brand */}
            <div className="md:col-span-2">
              <div className="flex items-center gap-2 mb-4">
                <div className="ix-footer__logo-mark w-8 h-8 rounded-lg flex items-center justify-center">
                  <svg viewBox="0 0 24 24" className="w-5 h-5" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z" />
                  </svg>
                </div>
                <span className="ix-footer__brand font-bold text-lg tracking-tight">
                  averlearning
                </span>
              </div>
              <p className="ix-footer__tagline text-sm leading-relaxed max-w-xs">
                Nền tảng luyện IELTS toàn diện với AI — 6 kỹ năng, phản hồi tức
                thì, chính xác.
              </p>
            </div>

            {/* Links */}
            <div>
              <p className="ix-footer__heading text-xs font-bold uppercase tracking-widest mb-4">
                Tính năng
              </p>
              <ul className="space-y-2.5">
                <li>
                  <a href="#features" className="ix-footer__link text-sm">
                    AI Feedback
                  </a>
                </li>
                <li>
                  <a href="#features" className="ix-footer__link text-sm">
                    Chấm điểm phát âm
                  </a>
                </li>
                <li>
                  <a href="#features" className="ix-footer__link text-sm">
                    Reading &amp; Listening
                  </a>
                </li>
                <li>
                  <a href="/grammar.html" className="ix-footer__link text-sm">
                    Grammar Wiki
                  </a>
                </li>
              </ul>
            </div>

            <div>
              <p className="ix-footer__heading text-xs font-bold uppercase tracking-widest mb-4">
                Tài khoản
              </p>
              <ul className="space-y-2.5">
                <li>
                  <a href="/login.html" className="ix-footer__link text-sm">
                    Đăng nhập
                  </a>
                </li>
                <li>
                  <a href="/login.html" className="ix-footer__link text-sm">
                    Đăng ký
                  </a>
                </li>
                <li>
                  <a href="/pages/home.html" className="ix-footer__link text-sm">
                    Trang chủ
                  </a>
                </li>
              </ul>
            </div>
          </div>

          <div className="ix-footer__divider pt-8 flex flex-col sm:flex-row justify-between items-center gap-4">
            <p className="ix-footer__copy text-sm">
              © 2026 averlearning. Mọi quyền được bảo lưu.
            </p>
            <p className="ix-footer__powered text-xs">
              Powered by Claude AI · Gemini AI · Whisper STT · Azure Pronunciation
            </p>
          </div>
        </div>
      </footer>

      <LandingBehavior />
    </div>
  );
}
