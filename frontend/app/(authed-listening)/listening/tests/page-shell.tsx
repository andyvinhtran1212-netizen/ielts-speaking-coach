// Markup only. Behavior is loaded by /js/listening-tests-list.js (legacy ESM module).
// All ids are a contract with that module; don't rename them.
// <aver-chrome> is rendered by page.tsx, not here.

export function ListeningTestsShell() {
  return (
    <div className="shell">
      <main className="lt-shell">
        <header className="lt-header">
          <p className="eyebrow"><a href="/pages/listening.html" style={{ color: 'var(--av-text-secondary)' }}>← Quay lại Listening</a></p>
          <h1>Cambridge IELTS <span className="accent">Full Tests</span></h1>
          <p className="subtitle">
            Bài thi đầy đủ 40 câu trên 4 sections — sát đề thật. Mỗi test kéo dài
            ~30 phút và không thể tua lại audio. Sau khi nộp bài, bạn sẽ nhận
            điểm số, band ước tính và phân tích bẫy đã mắc.
          </p>
        </header>

        <div className="empty-state" id="state-loading">Đang tải danh sách tests…</div>
        <div className="empty-state" id="state-empty" hidden>
          <p><strong>Chưa có test nào sẵn sàng.</strong></p>
          <p>Hãy quay lại sau khi admin xuất bản test mới.</p>
        </div>
        <div className="error-banner" id="state-error" hidden></div>

        <section id="lt-grid" className="lt-grid" hidden></section>
      </main>
    </div>
  );
}
