// Markup only. Behavior is loaded by /js/reading-skill.js (legacy ESM module).
// All ids are a contract with that module; don't rename them.
// <aver-chrome> is rendered by page.tsx, not here.

export function ReadingSkillShell() {
  return (
    <div className="shell">
      <main className="rv-shell">
        <header className="rv-header">
          <p className="eyebrow"><a href="/home" style={{ color: 'var(--av-text-secondary)' }}>← Trang chủ</a></p>
          <h1>Skill Practice <span className="accent">·</span> <span style={{ color: 'var(--av-text-muted)' }}>Luyện kỹ năng</span></h1>
          <p className="subtitle">Chọn một bài luyện theo kỹ năng đọc — skimming, scanning, detail, inference… — và kiểm tra hiểu ngay sau khi đọc.</p>
        </header>

        {/* Library switcher: L1 ↔ L2 ↔ L3 (Sprint 20.6 adds the Full Test entry). Changed /pages/reading-vocab.html → /reading/vocab */}
        <nav className="rv-libnav" aria-label="Reading libraries">
          <a className="rv-libnav__link" href="/reading/vocab">Vocab Reading</a>
          <a className="rv-libnav__link is-active" aria-current="page">Skill Practice</a>
          <a className="rv-libnav__link" href="/reading/test">Full Tests</a>
          <a className="rv-libnav__link" href="/reading/mini-test">Mini Tests</a>
        </nav>

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
              <option value="writer_view_TFNG">Writer's view (T/F/NG)</option>
            </select>
          </label>
        </div>

        <div className="rv-empty" id="state-loading">Đang tải…</div>
        <div className="rv-empty" id="state-empty" hidden>Chưa có bài luyện kỹ năng nào khớp bộ lọc.</div>
        <div className="rv-error" id="state-error" hidden></div>

        <div className="rv-grid" id="rv-grid" hidden></div>
      </main>
    </div>
  );
}
