// Markup tĩnh của trang Vocab Reading — chép nguyên vẹn từ
// `public/pages/reading-vocab.html`.
//
// HỢP ĐỒNG: mọi `id` và tên class ở đây là điểm bám của `public/js/reading-vocab.js`
// — chính TỆP ĐÓ được nạp cho cả hai vế, không có bản sao. Đổi một id ở đây là
// làm hỏng trang mà build vẫn xanh.
//
// `<aver-chrome>` KHÔNG dựng ở đây; `page.tsx` dựng nó. Bản port trang Bài viết
// từng chép cả thẻ đó từ legacy và ra HAI thanh điều hướng (#950) — phép so
// markup không thấy được vì component dựng nội dung trong Shadow DOM.
export function ReadingVocabShell() {
  return (
    <div className="shell">
      <main className="rv-shell">
        <header className="rv-header">
          <p className="eyebrow">
            <a href="/home" style={{ color: 'var(--av-text-secondary)' }}>← Trang chủ</a>
          </p>
          <h1>
            Vocab Reading <span className="accent">·</span>{' '}
            <span style={{ color: 'var(--av-text-muted)' }}>Thư viện</span>
          </h1>
          <p className="subtitle">
            Đọc đoạn văn ngắn, tra từ vựng ngay trong bài, và kiểm tra hiểu nhanh.
          </p>
        </header>

        {/* Library switcher: L1 ↔ L2 ↔ L3 (Sprint 20.6 adds the Full Test entry). */}
        <nav className="rv-libnav" aria-label="Reading libraries">
          <a className="rv-libnav__link is-active" aria-current="page">Vocab Reading</a>
          <a className="rv-libnav__link" href="/pages/reading-skill.html">Skill Practice</a>
          <a className="rv-libnav__link" href="/pages/reading-test.html">Full Tests</a>
          <a className="rv-libnav__link" href="/pages/reading-mini-test.html">Mini Tests</a>
        </nav>

        <div className="rv-filters">
          <label>
            Trình độ
            <select id="filter-difficulty">
              <option value="">Tất cả</option>
              <option value="foundation">Foundation</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
            </select>
          </label>
          <label>
            Chủ đề
            <select id="filter-tag"><option value="">Tất cả</option></select>
          </label>
        </div>

        <div className="rv-empty" id="state-loading">Đang tải…</div>
        <div className="rv-empty" id="state-empty" hidden>Chưa có bài đọc nào khớp bộ lọc.</div>
        <div className="rv-error" id="state-error" hidden></div>

        <div className="rv-grid" id="rv-grid" hidden></div>
      </main>
    </div>
  );
}
