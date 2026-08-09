// Markup only. Behavior is loaded by /js/reading-skill.js (legacy ESM module).
// All ids are a contract with that module; don't rename them.
// <aver-chrome> is rendered by page.tsx, not here.

export function ReadingSkillShell() {
  return (
    <div className="shell">
      <main className="rv-shell">
        <header className="rv-header rv-header--skill">
          <div className="rv-header__copy">
            <a className="rv-back" href="/home">← Trang chủ</a>
            <p className="rv-kicker">READING LAB · SKILLS</p>
            <h1>Luyện từng kỹ năng, <span>đọc nhanh và chính xác hơn.</span></h1>
            <p className="subtitle">Tập trung vào một mục tiêu mỗi lần — skimming, scanning, main idea, inference và các dạng câu hỏi IELTS thường gặp.</p>
          </div>
          <dl className="rv-header__stats" aria-label="Tổng quan thư viện kỹ năng">
            <div><dt id="rv-total-count">—</dt><dd>bài luyện</dd></div>
            <div><dt id="rv-focus-count">—</dt><dd>nhóm kỹ năng</dd></div>
            <div><dt>1 mục tiêu</dt><dd>Mỗi bài luyện</dd></div>
          </dl>
        </header>

        {/* Library switcher: L1 ↔ L2 ↔ L3 (Sprint 20.6 adds the Full Test entry). Changed /pages/reading-vocab.html → /reading/vocab */}
        <nav className="rv-libnav" aria-label="Reading libraries">
          <a className="rv-libnav__link" href="/reading/vocab">Vocab Reading</a>
          <a className="rv-libnav__link is-active" aria-current="page">Skill Practice</a>
          <a className="rv-libnav__link" href="/reading/test">Full Tests</a>
          <a className="rv-libnav__link" href="/reading/mini-test">Mini Tests</a>
        </nav>

        <section className="rv-library" aria-labelledby="rv-library-title">
          <header className="rv-library__toolbar">
            <div>
              <p className="rv-kicker">BÀI LUYỆN THEO KỸ NĂNG</p>
              <h2 id="rv-library-title">Chọn đúng điểm cần cải thiện</h2>
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
              <label>Kỹ năng
                <select id="filter-skill">
                  <option value="">Tất cả</option>
                  <option value="skimming">Skimming</option>
                  <option value="scanning">Scanning</option>
                  <option value="detail">Detail</option>
                  <option value="main_idea">Main idea</option>
                  <option value="inference">Inference</option>
                  <option value="vocabulary_in_context">Vocab in context</option>
                  <option value="reference_cohesion">Reference / cohesion</option>
                  <option value="writer_view_TFNG">Writer&apos;s view (T/F/NG)</option>
                </select>
              </label>
              <button className="rv-filter-reset" id="clear-filters" type="button" hidden>Xóa lọc</button>
            </div>
          </header>
          <div className="rv-empty" id="state-loading">Đang chuẩn bị bài luyện…</div>
          <div className="rv-empty" id="state-empty" hidden>Chưa có bài luyện kỹ năng nào khớp bộ lọc.</div>
          <div className="rv-error" id="state-error" hidden></div>
          <div className="rv-grid rv-grid--articles" id="rv-grid" hidden></div>
        </section>
      </main>
    </div>
  );
}
