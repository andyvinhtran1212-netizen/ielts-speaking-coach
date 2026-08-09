import type { ReactNode } from 'react';

export function ListeningSkillsShell({
  children,
  doneCount,
  totalCount,
  typeCount,
}: {
  children: ReactNode;
  doneCount: number | null;
  totalCount: number | null;
  typeCount: number | null;
}) {
  return (
    <div className="shell">
      <main className="ls-shell">
        <header className="ls-header">
          <a className="ls-back" href="/listening">← Quay lại Listening</a>
          <p className="eyebrow">LUYỆN THEO DẠNG CÂU HỎI</p>
          <h1>Chọn đúng kĩ năng, <span className="accent">luyện sâu hơn</span></h1>
          <p className="subtitle">
            Tập riêng từng dạng câu hỏi IELTS Listening, nhận điểm ngay sau khi nộp
            và nghe lại đúng đoạn audio để hiểu mình đã bỏ lỡ chi tiết nào.
          </p>
          {totalCount !== null && doneCount !== null && typeCount !== null ? (
            <div className="ls-summary" id="ls-summary" aria-live="polite">
              <div className="ls-summary__item">
                <span className="ls-summary__value" id="ls-total-count">{totalCount}</span>
                <span className="ls-summary__label">Bài đang mở</span>
              </div>
              <div className="ls-summary__item">
                <span className="ls-summary__value" id="ls-done-count">{doneCount}</span>
                <span className="ls-summary__label">Đã luyện</span>
              </div>
              <div className="ls-summary__item">
                <span className="ls-summary__value" id="ls-type-count">{typeCount}</span>
                <span className="ls-summary__label">Dạng kĩ năng</span>
              </div>
            </div>
          ) : null}
        </header>

        {children}
      </main>
    </div>
  );
}
