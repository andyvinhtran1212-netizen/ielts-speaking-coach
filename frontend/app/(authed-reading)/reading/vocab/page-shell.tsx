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
        <header className="rv-header rv-header--vocab">
          <div className="rv-header__copy">
            <a className="rv-back" href="/home">← Trang chủ</a>
            <p className="rv-kicker">READING LAB · VOCAB</p>
            <h1>Đọc để hiểu, <span>nhớ từ trong ngữ cảnh.</span></h1>
            <p className="subtitle">Bài đọc ngắn có chú giải tại chỗ, giúp bạn gặp từ mới trong câu thật và kiểm tra mức độ hiểu ngay sau khi đọc.</p>
          </div>
          <dl className="rv-header__stats" aria-label="Tổng quan thư viện từ vựng">
            <div><dt id="rv-total-count">—</dt><dd>bài đọc</dd></div>
            <div><dt>Trong bài</dt><dd>Tra từ tức thì</dd></div>
            <div><dt>Sau khi đọc</dt><dd>Kiểm tra nhanh</dd></div>
          </dl>
        </header>

        {/* Library switcher: L1 ↔ L2 ↔ L3 (Sprint 20.6 adds the Full Test entry). */}
        <nav className="rv-libnav" aria-label="Reading libraries">
          <a className="rv-libnav__link is-active" aria-current="page">Vocab Reading</a>
          <a className="rv-libnav__link" href="/reading/skill">Skill Practice</a>
          <a className="rv-libnav__link" href="/reading/test">Full Tests</a>
          <a className="rv-libnav__link" href="/reading/mini-test">Mini Tests</a>
        </nav>

        <section className="rv-library" aria-labelledby="rv-library-title">
          <header className="rv-library__toolbar">
            <div>
              <p className="rv-kicker">THƯ VIỆN BÀI ĐỌC</p>
              <h2 id="rv-library-title">Chọn một bài để bắt đầu</h2>
              <p className="rv-result-count" id="rv-result-count" aria-live="polite">Đang tải danh sách…</p>
            </div>
            <div className="rv-filters">
              <label>Trình độ
                <select id="filter-difficulty">
                  <option value="">Tất cả</option>
                  <option value="foundation">Foundation</option>
                  <option value="intermediate">Intermediate</option>
                  <option value="advanced">Advanced</option>
                </select>
              </label>
              <label>Chủ đề
                <select id="filter-tag"><option value="">Tất cả</option></select>
              </label>
              <button className="rv-filter-reset" id="clear-filters" type="button" hidden>Xóa lọc</button>
            </div>
          </header>
          <div className="rv-empty" id="state-loading">Đang chuẩn bị bài đọc…</div>
          <div className="rv-empty" id="state-empty" hidden>Chưa có bài đọc nào khớp bộ lọc.</div>
          <div className="rv-error" id="state-error" hidden></div>
          <div className="rv-grid rv-grid--articles" id="rv-grid" hidden></div>
        </section>
      </main>
    </div>
  );
}
