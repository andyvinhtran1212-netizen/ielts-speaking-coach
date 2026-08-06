// Vỏ tĩnh của trang Thống kê Listening — chép TRUNG THỰC từ `public/pages/listening-analytics.html`.
//
// Hành vi KHÔNG được port: `page.tsx` nạp thẳng module legacy
// `/js/listening-analytics.js` — CHÍNH tệp trang legacy dùng — và module đó tìm phần tử
// theo **id**. Trang này có 13 id (analytics-surface, day-chart, day-labels, mode-table-body, recent-list, stat-acc, stat-avg, stat-avg-sub, stat-total, state-empty, state-error, state-loading, weakest-banner); đổi tên bất kỳ chỗ nào
// là hỏng CẢ HAI bản cùng lúc.
//
// ICON LUCIDE nhúng thẳng SVG chứ không để `data-lucide`: lucide@1.17.0 tự thay
// thẻ đó khi nạp và đua với hydrate (React #418). Nội dung SVG ĐO TỪ TRANG
// LEGACY ĐANG CHẠY, không đoán — bản đoán đầu tiên sai số path/thứ tự ở 2 icon
// và phép so theo đường DOM bắt được.
//
// `<aver-chrome>` do `page.tsx` dựng, KHÔNG dựng ở đây (bài học #950: chép cả
// thẻ đó từ legacy ra hai thanh điều hướng).

export function ListeningAnalyticsShell() {
  return (
    <div className="shell">
      <main className="analytics-shell">
        <header className="analytics-header">
          <p className="eyebrow"><a href="/listening" style={{ color: "var(--av-text-secondary)" }}>← Quay lại</a></p>
          <h1>Thống kê <span className="accent">Listening</span></h1>
          <p className="subtitle">
            Theo dõi tiến độ luyện nghe của bạn theo dạng bài và theo thời gian.
          </p>
        </header>

        <div className="range-tabs" role="tablist" aria-label="Khoảng thời gian">
          <button className="range-tab" data-range="7d" type="button">7 ngày</button>
          <button className="range-tab is-active" data-range="30d" type="button">30 ngày</button>
          <button className="range-tab" data-range="all" type="button">Tất cả</button>
        </div>

        <div className="empty-state" id="state-loading">Đang tải…</div>
        <div className="empty-state" id="state-empty" hidden>
          <p><strong>Chưa có dữ liệu luyện tập trong khoảng này.</strong></p>
          <p>Bắt đầu một bài nghe để thấy thống kê.</p>
        </div>
        <div className="error-banner" id="state-error" hidden></div>

        <div id="analytics-surface" hidden style={{ display: "flex", flexDirection: "column", gap: "var(--av-space-6)" }}>
          <div className="weakest-banner" id="weakest-banner" hidden></div>

          <section className="summary-grid">
            <div className="stat-card">
              <span className="stat-label">Tổng số lượt làm</span>
              <span className="stat-value" id="stat-total">0</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Đúng trung bình</span>
              <span className="stat-value" id="stat-avg">—</span>
              <span className="stat-sub" id="stat-avg-sub"></span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Tỷ lệ hoàn thành</span>
              <span className="stat-value" id="stat-acc">—</span>
            </div>
          </section>

          <section className="section-card">
            <h2>Theo dạng bài</h2>
            <table className="mode-table">
              <thead>
                <tr>
                  <th>Dạng</th>
                  <th className="num">Số bài</th>
                  <th className="num">Đúng TB</th>
                  <th className="num">Hoàn thành</th>
                </tr>
              </thead>
              <tbody id="mode-table-body"></tbody>
            </table>
          </section>

          <section className="section-card">
            <h2>Theo ngày (14 ngày gần nhất)</h2>
            <div className="day-chart" id="day-chart"></div>
            <div className="day-labels" id="day-labels"></div>
          </section>

          <section className="section-card">
            <h2>Hoạt động gần đây</h2>
            <ul className="recent-list" id="recent-list"></ul>
          </section>
        </div>
      </main>
    </div>
  );
}
