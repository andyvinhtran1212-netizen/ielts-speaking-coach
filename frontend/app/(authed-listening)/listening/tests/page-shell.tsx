import type { ReactNode } from 'react';

export function ListeningTestsShell({
  children,
  totalCount,
}: {
  children: ReactNode;
  totalCount: number | null;
}) {
  return (
    <div className="shell">
      <main className="lt-shell">
        <header className="lt-header">
          <a className="lt-back" href="/listening">← Quay lại Listening</a>
          <p className="eyebrow">MÔ PHỎNG BÀI THI LISTENING</p>
          <h1>Full test, <span className="accent">làm trọn một lượt</span></h1>
          <p className="subtitle">
            Hoàn thành 40 câu qua 4 sections trong điều kiện sát bài thi thật.
            Audio phát một lượt; sau khi nộp, bạn nhận điểm, band ước tính và
            xem lại từng bẫy đã mắc.
          </p>
          {totalCount !== null ? (
            <div className="lt-summary" id="lt-summary" aria-live="polite">
              <div className="lt-summary__item">
                <span className="lt-summary__value" id="lt-total-count">{totalCount}</span>
                <span className="lt-summary__label">Đề đang mở</span>
              </div>
              <div className="lt-summary__item">
                <span className="lt-summary__value">40</span>
                <span className="lt-summary__label">Câu mỗi đề</span>
              </div>
              <div className="lt-summary__item">
                <span className="lt-summary__value">4</span>
                <span className="lt-summary__label">Sections</span>
              </div>
            </div>
          ) : null}
        </header>

        {children}
      </main>
    </div>
  );
}
