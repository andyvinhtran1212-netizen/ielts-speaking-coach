// Markup only. Behavior is loaded by /js/reading-test.js (legacy ESM module).
// All ids are a contract with that module; don't rename them.
// <aver-chrome> is rendered by page.tsx, not here.

export function ReadingTestShell() {
  return (
    <div className="shell">
      <main className="rv-shell">
        <header className="rv-header rv-header--test">
          <div className="rv-header__copy">
            <a className="rv-back" href="/home">← Trang chủ</a>
            <p className="rv-kicker">READING LAB · FULL TEST</p>
            <h1>Thi thử trọn bộ, <span>làm quen áp lực phòng thi.</span></h1>
            <p className="subtitle">Mô phỏng bài Academic Reading đầy đủ với giao diện làm bài, đồng hồ, bảng câu hỏi và phần chữa bài sau khi nộp.</p>
          </div>
          <dl className="rv-header__stats" aria-label="Cấu trúc Full Test">
            <div><dt id="rv-total-count">—</dt><dd>đề thi</dd></div>
            <div><dt>3 đoạn</dt><dd>40 câu hỏi</dd></div>
            <div><dt>60 phút</dt><dd>Đúng chuẩn thi</dd></div>
          </dl>
        </header>

        {/* Library switcher: L1 ↔ L2 ↔ L3 (Sprint 20.6 adds the Full Test entry). Changed /pages/reading-vocab.html → /reading/vocab */}
        <nav className="rv-libnav" aria-label="Reading libraries">
          <a className="rv-libnav__link" href="/reading/vocab">Vocab Reading</a>
          <a className="rv-libnav__link" href="/reading/skill">Skill Practice</a>
          <a className="rv-libnav__link is-active" aria-current="page">Full Tests</a>
          <a className="rv-libnav__link" href="/reading/mini-test">Mini Tests</a>
        </nav>

        <section className="rv-library" aria-labelledby="rv-library-title">
          <header className="rv-library__toolbar">
            <div>
              <p className="rv-kicker">ĐỀ THI ĐẦY ĐỦ</p>
              <h2 id="rv-library-title">Chọn đề và bắt đầu 60 phút</h2>
              <p className="rv-result-count" id="rv-result-count" aria-live="polite">Đang tải danh sách…</p>
            </div>
            <div className="rv-filters">
              <label>Mô-đun
                <select id="filter-module">
                  <option value="">Tất cả</option>
                  <option value="academic">Academic</option>
                  <option value="general_training" disabled>General Training (Phase B)</option>
                </select>
              </label>
              <button className="rv-filter-reset" id="clear-filters" type="button" hidden>Xóa lọc</button>
            </div>
          </header>
          <div className="rv-empty" id="state-loading">Đang chuẩn bị đề thi…</div>
          <div className="rv-empty" id="state-empty" hidden>Chưa có bài thi nào.</div>
          <div className="rv-error" id="state-error" hidden></div>
          <div className="rv-grid rv-grid--tests" id="rv-grid" hidden></div>
        </section>
      </main>
    </div>
  );
}
