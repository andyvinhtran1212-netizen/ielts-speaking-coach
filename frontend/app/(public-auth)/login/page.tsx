import type { Metadata } from 'next';

import { LoginBehavior } from './login-behavior';

export const metadata: Metadata = {
  title: 'Đăng nhập — Aver Learning',
  description: 'Đăng nhập Aver Learning bằng Google và kích hoạt tài khoản bằng access code.',
  robots: { index: false, follow: false },
};

const skills = [
  ['speaking', 'Speaking', 'Ghi âm & chấm band'],
  ['writing', 'Writing', 'Essay feedback'],
  ['reading', 'Reading', 'Comprehension'],
  ['listening', 'Listening', 'Audio drills'],
  ['grammar', 'Grammar', 'Wiki & exercises'],
  ['vocabulary', 'Vocabulary', 'Topic flashcards'],
] as const;

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

export default function LoginPage() {
  return (
    <div className="lx-shell">
      <aside className="lx-pitch" aria-label="Giới thiệu Aver Learning">
        <a className="lx-logo" href="/">Aver<span>Learning</span></a>
        <p className="lx-eyebrow">Nền tảng luyện IELTS cùng AI</p>
        <h2 className="lx-headline">Mở khóa cả 6 kỹ năng IELTS trong một nền tảng</h2>
        <div className="lx-skills">
          {skills.map(([slug, name, tag], index) => (
            <div className="lx-skill-row" key={slug}>
              <span className={`lx-skill-dot is-${slug}`} style={{ animationDelay: `${index * 0.5}s` }} />
              <span className="lx-skill-name">{name}</span>
              <span className="lx-skill-tag">{tag}</span>
            </div>
          ))}
        </div>
        <div className="lx-stat">
          <span className="lx-stat-number" id="pitch-stat">—</span>
          <span className="lx-stat-label">buổi luyện đã hoàn thành<br />trên nền tảng</span>
        </div>
      </aside>

      <section className="lx-form-panel">
        <nav className="lx-form-nav" aria-label="Tùy chọn giao diện">
          <button className="lx-theme-toggle av-theme-toggle" type="button" aria-label="Chuyển giao diện sáng/tối">
            <svg className="icon-sun" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v4m0 12v4M4.22 4.22l2.83 2.83m9.9 9.9 2.83 2.83M2 12h4m12 0h4M4.22 19.78l2.83-2.83m9.9-9.9 2.83-2.83" /></svg>
            <svg className="icon-moon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
            <span>Giao diện</span>
          </button>
        </nav>

        <main className="lx-form-main">
          <div className="lx-form-card">
            <h1 className="lx-form-heading">Bắt đầu luyện tập</h1>
            <p className="lx-form-subheading">Đăng ký miễn phí — <strong>kích hoạt bằng access code</strong> để bắt đầu.</p>
            <LoginBehavior googleIcon={<GoogleIcon />} />
          </div>
        </main>
      </section>
    </div>
  );
}
