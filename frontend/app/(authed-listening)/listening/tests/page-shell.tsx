// Markup only. Behavior is loaded by /js/listening-tests-list.js (legacy ESM module).
// All ids are a contract with that module; don't rename them.
// <aver-chrome> is rendered by page.tsx, not here.

export function ListeningTestsShell() {
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
          <div className="lt-summary" id="lt-summary" hidden aria-live="polite">
            <div className="lt-summary__item">
              <span className="lt-summary__value" id="lt-total-count">0</span>
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
        </header>

        <div className="empty-state" id="state-loading">Đang tải danh sách tests…</div>
        <div className="empty-state" id="state-empty" hidden>
          <p><strong>Chưa có test nào sẵn sàng.</strong></p>
          <p>Hãy quay lại sau khi admin xuất bản test mới.</p>
        </div>
        <div className="error-banner" id="state-error" hidden></div>

        <section className="lt-library" id="lt-library" hidden aria-labelledby="lt-library-title">
          <div className="lt-toolbar">
            <div>
              <p className="eyebrow">THƯ VIỆN FULL TEST</p>
              <h2 id="lt-library-title">Chọn đề thi</h2>
            </div>
            <div className="lt-filter" role="group" aria-label="Lọc full test">
              <button className="lt-filter__button is-active" type="button" data-filter="all" aria-pressed="true">Tất cả</button>
              <button className="lt-filter__button" type="button" data-filter="new" aria-pressed="false">Chưa làm</button>
              <button className="lt-filter__button" type="button" data-filter="done" aria-pressed="false">Đã làm</button>
            </div>
          </div>
          <p className="lt-visible-count" id="lt-visible-count" aria-live="polite"></p>
          <div id="lt-grid" className="lt-grid"></div>
        </section>
      </main>
    </div>
  );
}
