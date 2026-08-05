// Vỏ tĩnh của trang chủ học viên — chép TRUNG THỰC từ `public/pages/home.html`.
//
// VÌ SAO CHÉP NGUYÊN CLASS/ID THAY VÌ "VIẾT LẠI CHO ĐẸP": bài học pilot 2 (#741)
// — dựng lại từ đầu làm gãy cascade CSS và chỉ phát hiện được nhờ so ảnh chụp.
// Ở đây còn một ràng buộc mạnh hơn: `home.js` (bản legacy) và `home-behavior.tsx`
// (bản Next) đều **với tay vào DOM theo id và class** — `renderHero` đọc
// `#hero-streak`/`#hero-sessions`/`#hero-essays`, `renderSkillCard` đọc
// `[data-skill]` rồi vá `.js-val`/`.js-unit`/`.js-sub`/`.js-activity`/`.js-cta`.
// Đổi tên bất kỳ chỗ nào là hỏng cả hai bản.
//
// Thẻ kỹ năng dựng từ BẢNG thay vì chép 6 lần: sáu thẻ có cùng khuôn, chỉ khác
// icon/tiêu đề/đơn vị/mô tả. Chép tay 6 lần là sáu cơ hội gõ sai một class hook.
import type { ReactNode } from 'react';

/** Sáu kỹ năng, đúng thứ tự và đúng nội dung của bản legacy. */
const SKILLS: Array<{
  id: string;
  icon: string;
  title: string;
  unit: string;
  sub: ReactNode;
  /** Thẻ nào khởi tạo ở trạng thái đang tải (`…`) thay vì gạch ngang. */
  loading?: boolean;
}> = [
  { id: 'writing', icon: '✍︎', title: 'Writing', unit: 'band',
    sub: <>Bài luận Task 1 &amp; Task 2 với feedback chi tiết.</> },
  { id: 'speaking', icon: '🎙', title: 'Speaking', unit: 'band',
    sub: <>Luyện nói 3 phần và nhận điểm band tự động.</> },
  { id: 'grammar', icon: '✦', title: 'Grammar', unit: 'bài đã xem', loading: true,
    sub: <>Khám phá 67 bài học ngữ pháp.</> },
  { id: 'vocabulary', icon: '⌗', title: 'Vocabulary', unit: 'từ', loading: true,
    sub: <>Wallet từ vựng cá nhân + flashcard SRS.</> },
  { id: 'reading', icon: '✸', title: 'Reading', unit: 'band',
    sub: <>Bài đọc IELTS với phân tích cấu trúc đoạn và chiến lược tìm ý chính.</> },
  { id: 'listening', icon: '◐', title: 'Listening', unit: 'bài', loading: true,
    sub: <>Bài nghe với note-taking pattern và phân tích bẫy đáp án.</> },
];

function SkillCard({ skill }: { skill: (typeof SKILLS)[number] }) {
  return (
    <article className="skill-card" data-skill={skill.id}>
      <div className="head">
        <div className="icon">{skill.icon}</div>
        <span className="arrow">→</span>
      </div>
      <h3>{skill.title}</h3>
      <div className="metric-row">
        <span className="metric">
          <span className={skill.loading ? 'js-val is-loading' : 'js-val'}>
            {skill.loading ? '…' : '—'}
          </span>
          <span className="unit"> <span className="js-unit">{skill.unit}</span></span>
        </span>
      </div>
      <div className="sub-metric js-sub">{skill.sub}</div>
      <div className="footer">
        <span className="last-activity js-activity">—</span>
        <span className="cta js-cta">{skill.title}</span>
      </div>
    </article>
  );
}

/** Một ô thống kê ở hero. Giữ nguyên id — `renderHero` với tay vào theo id. */
function HeroStat({
  id, label, unit, extra, className,
}: { id: string; label: string; unit: string; extra?: ReactNode; className?: string }) {
  return (
    <div className={className ? `hero-stat ${className}` : 'hero-stat'} id={id}>
      <span className="label">{label}</span>
      <span className="value">
        <span className="value-num is-loading">…</span>
        <span className="unit">{unit}</span>
        {extra}
      </span>
    </div>
  );
}

export function HomeShell() {
  return (
    <div className="shell">
      {/* Băng lỗi — `renderError` bỏ `hidden` khi có sự cố. */}
      <div id="error-banner" className="error-banner hidden" role="alert" hidden />

      <header className="greeting">
        <div>
          <p className="eyebrow">Trang chủ</p>
          <h1>Xin chào, <span className="name" id="greeting-name">…</span></h1>
          <p className="lede">
            Tiếp tục hành trình IELTS của bạn — luyện đều mỗi ngày để giữ đà tiến bộ.
          </p>
        </div>

        <div className="hero-stats" aria-label="Tổng quan">
          <HeroStat
            id="hero-streak" label="Streak" unit="ngày" className="streak"
            // ICON NHÚNG THẲNG, KHÔNG DÙNG `data-lucide` — CÓ CHỦ Ý.
            //
            // lucide@1.17.0 TỰ thay mọi `[data-lucide]` bằng `<svg>` ngay khi
            // script nạp xong — KHÔNG qua `window.lucide.createIcons()` (bọc hàm
            // đó lại và đếm: 0 lần gọi, mà thẻ <i> vẫn biến mất). Nên bỏ lời gọi
            // trong layout là vô ích; chừng nào còn `data-lucide` trong cây React
            // thì còn đua với hydrate: nếu lucide (defer, CDN) thắng, React quay
            // lại thấy <svg> ở chỗ nó vừa dựng <i> → Minified React error #418,
            // cả cây bị dựng lại phía client.
            //
            // `suppressHydrationWarning` KHÔNG cứu được: nó chỉ che khác biệt
            // thuộc-tính/text trên CHÍNH phần tử đó, không che việc con bị đổi
            // hẳn loại thẻ. Đã thử, vẫn #418.
            //
            // Đo bằng `tooling/repro-418.mjs` (cổng riêng — 3000 có thể đang bận):
            //   đua tự nhiên → 0 lỗi  ← chạy vài lần xanh KHÔNG chứng minh gì
            //   --slow-react → #418 tất định, TRƯỚC vá; 3/3 sạch SAU vá
            // Bản dev (React không rút gọn) in ra đúng chỗ lệch: React dựng
            // `<i data-lucide="flame">`, DOM thực tế là `<svg>`.
            //
            // `/profile` không dính vì dùng 0 icon lucide — nên khuôn chép từ
            // profile chưa từng gặp ca này.
            //
            // SVG dưới đây chép NGUYÊN VĂN cái lucide@1.17.0 sinh ra, chỉ BỎ
            // thuộc tính `data-lucide` để lucide không nhận diện nữa. Giữ
            // `class="lucide lucide-flame"`; CSS bám vào `.flame svg`
            // (home.css:150) nên vẫn khớp, và 0 selector nào dùng [data-lucide].
            extra={(
              <span className="flame" aria-hidden="true">
                <svg
                  xmlns="http://www.w3.org/2000/svg" width="24" height="24"
                  viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  aria-hidden="true" className="lucide lucide-flame"
                >
                  <path d="M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4" />
                </svg>
              </span>
            )}
          />
          <HeroStat id="hero-sessions" label="Speaking" unit="buổi" />
          <HeroStat id="hero-essays" label="Writing" unit="bài" />
        </div>
      </header>

      {/* GĐ 3 — "Lớp của tôi". Ẩn cho tới khi `/api/class/me` xác nhận học viên
          có lớp: phần lớn vào bằng mã đại trà và không thuộc lớp nào, nên một
          thẻ lớp rỗng trên mọi trang chủ chỉ là nhiễu. */}
      <section id="class-strip" hidden>
        <div className="section-head">
          <h2>Lớp của tôi</h2>
          <span className="rule" aria-hidden="true" />
          <span className="meta" id="class-strip-meta" />
        </div>
        <a className="skill-card" id="class-strip-card" href="/pages/my-class.html">
          <div className="head">
            <div className="icon">◎</div>
            <span className="arrow">→</span>
          </div>
          <h3 id="class-strip-name">—</h3>
          <div className="metric-row">
            <span className="metric">
              <span className="js-val" id="class-strip-todo">—</span>
              <span className="unit"> bài cần nộp</span>
            </span>
          </div>
          <div className="sub-metric" id="class-strip-sub">
            Bài tập và nội dung buổi học của lớp bạn.
          </div>
          <div className="footer">
            <span className="last-activity" id="class-strip-alarm" />
            <span className="cta">Mở lớp</span>
          </div>
        </a>
      </section>

      <section>
        <div className="section-head">
          <h2>Kỹ năng IELTS</h2>
          <span className="rule" aria-hidden="true" />
          <span className="meta">6 kỹ năng đang mở</span>
        </div>

        {/* Thẻ được render sẵn để hiện ngay từ lần parse đầu; behavior chỉ vá
            `.js-*` khi API trả về — không có khoảng trống skeleton. */}
        <div className="skill-grid">
          {SKILLS.map((s) => <SkillCard key={s.id} skill={s} />)}
        </div>
      </section>

      <section style={{ marginTop: 20 }}>
        {/* Thẻ bắt đầu + các ô kết quả nằm cạnh nhau; ô kết quả đã trả điểm do
            `home-mock-tiles.js` chèn vào bên cạnh thẻ bắt đầu. */}
        <div className="mock-hub__grid" id="mock-hub-grid">
          <a href="/pages/full-test.html" className="mock-start">
            <div className="mock-start__title">🎯 Thi thử Full Test 4 kỹ năng →</div>
            <div className="mock-start__sub">
              Listening + Reading + Writing (một đồng hồ tổng) + Speaking — thu bài kín,
              giám khảo chấm và trả điểm sau.
            </div>
          </a>
        </div>
      </section>

      <footer className="page-footer">
        <span>
          Cần trợ giúp?{' '}
          <a className="aver-link" href="mailto:hello@averlearning.com">Liên hệ giảng viên →</a>
        </span>
        <span className="version">Aver Learning · Light theme default</span>
      </footer>
    </div>
  );
}
