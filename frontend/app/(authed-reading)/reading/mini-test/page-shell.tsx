// Markup only. Behavior is loaded by /js/reading-mini-test.js (legacy ESM module).
// All ids are a contract with that module; don't rename them.
// <aver-chrome> is rendered by page.tsx, not here.

export function ReadingMiniTestShell() {
  return (
    <div className="shell">
      <main className="rv-shell">
        <header className="rv-header rv-header--mini">
          <div className="rv-header__copy">
            <a className="rv-back" href="/home">← Trang chủ</a>
            <p className="rv-kicker">READING LAB · MINI TEST</p>
            <h1>Một đoạn văn, <span>một phiên luyện tập trung.</span></h1>
            <p className="subtitle">Luyện theo nhịp ngắn với giao diện và phần chữa bài giống Full Test — phù hợp khi bạn chưa có đủ 60 phút.</p>
          </div>
          <dl className="rv-header__stats" aria-label="Cấu trúc Mini Test">
            <div><dt id="rv-total-count">—</dt><dd>mini test</dd></div>
            <div><dt>1 đoạn</dt><dd>Mỗi đề</dd></div>
            <div><dt id="rv-duration-count">—</dt><dd>thời lượng phổ biến</dd></div>
          </dl>
        </header>

        {/* Library switcher: Vocab ↔ Skill ↔ Full Test ↔ Mini Test. Changed /pages/reading-vocab.html → /reading/vocab */}
        <nav className="rv-libnav" aria-label="Reading libraries">
          <a className="rv-libnav__link" href="/reading/vocab">Vocab Reading</a>
          <a className="rv-libnav__link" href="/reading/skill">Skill Practice</a>
          <a className="rv-libnav__link" href="/reading/test">Full Tests</a>
          <a className="rv-libnav__link is-active" aria-current="page">Mini Tests</a>
        </nav>

        <section className="rv-library" aria-labelledby="rv-library-title">
          <header className="rv-library__toolbar">
            <div>
              <p className="rv-kicker">BÀI THI NHỊP NGẮN</p>
              <h2 id="rv-library-title">Chọn một mini test</h2>
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
          <div className="rv-empty" id="state-loading">Đang chuẩn bị mini test…</div>
          <div className="rv-empty" id="state-empty" hidden>Chưa có mini test nào.</div>
          <div className="rv-error" id="state-error" hidden></div>
          <div className="rv-grid rv-grid--tests" id="rv-grid" hidden></div>
        </section>
      </main>
    </div>
  );
}
