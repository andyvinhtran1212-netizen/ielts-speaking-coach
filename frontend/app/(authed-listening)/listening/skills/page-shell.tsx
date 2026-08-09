import type { ReactNode } from 'react';

export function ListeningSkillsShell({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="shell">
        <main className="ls-shell">
          <header className="ls-header">
            <p className="eyebrow"><a href="/listening" style={{ color: "var(--av-text-secondary)" }}>← Quay lại Listening</a></p>
            <h1>Luyện <span className="accent">kĩ năng</span></h1>
            <p className="subtitle">
              Chọn dạng câu hỏi bạn muốn luyện riêng (điền form, bản đồ, nối, trắc nghiệm…).
              Mỗi bài là 1 section ngắn — cùng giao diện làm bài &amp; chữa bài (nghe lại đúng
              đoạn audio) như Mini Test, chấm điểm sau khi nộp.
            </p>
          </header>

          {children}
        </main>
      </div>
    </>
  );
}
