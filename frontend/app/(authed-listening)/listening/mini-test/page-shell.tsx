import type { ReactNode } from 'react';

export function ListeningMiniTestShell({
  children,
  doneCount,
  newCount,
  totalCount,
}: {
  children: ReactNode;
  doneCount: number | null;
  newCount: number | null;
  totalCount: number | null;
}) {
  return (
    <div className="shell">
      <main className="lt-shell">
        <header className="lt-header">
          <a className="lt-back" href="/listening">← Quay lại Listening</a>
          <p className="eyebrow">LUYỆN NGHE THEO CHẶNG NGẮN</p>
          <h1>Mini test, <span className="accent">một section mỗi lượt</span></h1>
          <p className="subtitle">
            Tập trung trọn vẹn vào một section, nhận điểm ngay sau khi nộp rồi
            quay lại đúng đoạn audio để hiểu vì sao mình nghe sai.
          </p>
          {totalCount !== null && newCount !== null && doneCount !== null ? (
            <div className="lt-summary" id="lt-summary" aria-live="polite">
              <div className="lt-summary__item">
                <span className="lt-summary__value" id="lt-total-count">{totalCount}</span>
                <span className="lt-summary__label">Bài đang mở</span>
              </div>
              <div className="lt-summary__item">
                <span className="lt-summary__value" id="lt-new-count">{newCount}</span>
                <span className="lt-summary__label">Chưa làm</span>
              </div>
              <div className="lt-summary__item">
                <span className="lt-summary__value" id="lt-done-count">{doneCount}</span>
                <span className="lt-summary__label">Đã luyện</span>
              </div>
            </div>
          ) : null}
        </header>

        {children}
      </main>
    </div>
  );
}
