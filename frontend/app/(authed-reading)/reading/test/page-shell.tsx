// Markup only. Behavior is loaded by /js/reading-test.js (legacy ESM module).
// All ids are a contract with that module; don't rename them.
// <aver-chrome> is rendered by page.tsx, not here.

export function ReadingTestShell() {
  return (
    <div className="shell">
      <main className="rv-shell">
        <header className="rv-header">
          <p className="eyebrow"><a href="/home" style={{ color: 'var(--av-text-secondary)' }}>← Trang chủ</a></p>
          <h1>Full Tests <span className="accent">·</span> <span style={{ color: 'var(--av-text-muted)' }}>Cambridge-style</span></h1>
          <p className="subtitle">Bài thi đầy đủ 60 phút — 3 đoạn văn, 40 câu hỏi, kèm bảng điểm + band IELTS.</p>
        </header>

        {/* Library switcher: L1 ↔ L2 ↔ L3 (Sprint 20.6 adds the Full Test entry). Changed /pages/reading-vocab.html → /reading/vocab */}
        <nav className="rv-libnav" aria-label="Reading libraries">
          <a className="rv-libnav__link" href="/reading/vocab">Vocab Reading</a>
          <a className="rv-libnav__link" href="/reading/skill">Skill Practice</a>
          <a className="rv-libnav__link is-active" aria-current="page">Full Tests</a>
          <a className="rv-libnav__link" href="/reading/mini-test">Mini Tests</a>
        </nav>

        <div className="rv-filters">
          <label>Mô-đun
            <select id="filter-module">
              <option value="">Tất cả</option>
              <option value="academic">Academic</option>
              <option value="general_training" disabled>General Training (Phase B)</option>
            </select>
          </label>
        </div>

        <div className="rv-empty" id="state-loading">Đang tải…</div>
        <div className="rv-empty" id="state-empty" hidden>Chưa có bài thi nào.</div>
        <div className="rv-error" id="state-error" hidden></div>

        <div className="rv-grid" id="rv-grid" hidden></div>
      </main>
    </div>
  );
}
