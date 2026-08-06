// Vỏ tĩnh của trang Kho bài nghe — chép TRUNG THỰC từ `public/pages/listening-browse.html`.
//
// Hành vi KHÔNG được port: `page.tsx` nạp thẳng module legacy
// `/js/listening-browse.js` — CHÍNH tệp trang legacy dùng — và module đó tìm phần tử
// theo **id**. Trang này có 7 id (content-grid, filter-accent, filter-cefr, filter-section, state-empty, state-error, state-loading); đổi tên bất kỳ chỗ nào
// là hỏng CẢ HAI bản cùng lúc.
//
// ICON LUCIDE nhúng thẳng SVG chứ không để `data-lucide`: lucide@1.17.0 tự thay
// thẻ đó khi nạp và đua với hydrate (React #418). Nội dung SVG ĐO TỪ TRANG
// LEGACY ĐANG CHẠY, không đoán — bản đoán đầu tiên sai số path/thứ tự ở 2 icon
// và phép so theo đường DOM bắt được.
//
// `<aver-chrome>` do `page.tsx` dựng, KHÔNG dựng ở đây (bài học #950: chép cả
// thẻ đó từ legacy ra hai thanh điều hướng).

export function ListeningBrowseShell() {
  return (
    <div className="shell">
      <main className="browse-shell">
        <header className="browse-header">
          <p className="eyebrow"><a href="/listening" style={{ color: "var(--av-text-secondary)" }}>← Quay lại</a></p>
          <h1>Kho bài nghe <span className="accent">·</span> <span style={{ color: "var(--av-text-muted)" }}>Browse</span></h1>
          <p className="subtitle">
            Chọn một bài nghe rồi bắt đầu luyện với dạng bài bạn muốn.
          </p>
        </header>

        <div className="browse-filters">
          <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "var(--av-fs-xs)", color: "var(--av-text-muted)" }}>
            Accent
            <select id="filter-accent">
              <option value="">Tất cả</option>
              <option value="us_general">US</option>
              <option value="uk_rp">UK</option>
              <option value="au">AU</option>
              <option value="ca">CA</option>
              <option value="other">Khác</option>
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "var(--av-fs-xs)", color: "var(--av-text-muted)" }}>
            CEFR
            <select id="filter-cefr">
              <option value="">Tất cả</option>
              <option value="A2">A2</option>
              <option value="B1">B1</option>
              <option value="B2">B2</option>
              <option value="C1">C1</option>
              <option value="C2">C2</option>
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "var(--av-fs-xs)", color: "var(--av-text-muted)" }}>
            Section
            <select id="filter-section">
              <option value="">Tất cả</option>
              <option value="1">Section 1</option>
              <option value="2">Section 2</option>
              <option value="3">Section 3</option>
              <option value="4">Section 4</option>
            </select>
          </label>
        </div>

        <div className="empty-state" id="state-loading">Đang tải…</div>
        <div className="empty-state" id="state-empty" hidden>
          Chưa có bài nghe nào khớp bộ lọc.
        </div>
        <div className="error-banner" id="state-error" hidden></div>

        <div className="content-grid" id="content-grid" hidden></div>
      </main>
    </div>
  );
}
