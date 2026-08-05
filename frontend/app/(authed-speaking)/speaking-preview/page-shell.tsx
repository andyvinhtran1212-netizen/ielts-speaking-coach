// Vỏ tĩnh của trang Speaking — chép TRUNG THỰC từ `public/pages/speaking.html`.
//
// VÌ SAO CHÉP CƠ HỌC THAY VÌ "VIẾT LẠI CHO ĐẸP": bài học pilot 2 (#741) — dựng
// lại từ đầu làm gãy cascade CSS và chỉ phát hiện được nhờ so ảnh chụp. Ở đây
// còn một ràng buộc mạnh hơn: tầng hành vi (PR sau) với tay vào DOM theo **id**
// và **class**, đúng như `home-behavior.tsx` đang làm với trang chủ. Trang này
// có 89 id riêng biệt; đổi tên bất kỳ chỗ nào là hỏng cả hai bản.
//
// HANDLER NỘI TUYẾN ĐÃ BỎ RA — CÓ CHỦ Ý. Bản legacy có 27 handler nội tuyến
// (`onclick="openTopicModal()"` …). Đo được: **0/27 cái điều hướng**, mà
// `hrefFromInlineHandler` (parity-core.mjs:118) chỉ trích điều hướng — nên cổng
// parity MÙ với cả 27. Chúng thuần là hành vi, sẽ gắn bằng listener theo id ở
// PR hành vi, giống khuôn `home-behavior.tsx`. Danh sách đầy đủ nằm trong mô tả
// PR để không cái nào rơi mất.
//
// TRẠNG THÁI: MỚI CÓ VỎ. Chưa có tầng hành vi, chưa có ai trỏ tới route này, và
// `/pages/speaking.html` vẫn là canonical.

export function SpeakingShell() {
  return (
    <>
        {/* Canonical chrome (Sprint 7.12 — <aver-chrome> Web Component;
             Speaking active). Page-authoritative pill population via
             renderUser() → setUser() preserves the Sprint 7.8-hotfix permissions
             context contract through the typed API instead of DOM-poking
             across the shadow boundary. */}
      {/* Sprint 8.1 — main-tab-nav retired. Dashboard view is the page's
             default landing state; mode entry is now via the `.mode-card`
             grid in the dashboard's "Bắt đầu luyện tập" section. Re-clicking
             the chrome Speaking nav link reloads /pages/speaking.html and
             restores the dashboard view (Phase B Q5). The mode panels
             (#tab-practice / #tab-partbpart / #tab-fulltest) are still
             toggled by switchMainTab() from the mode-cards' click handler. */}

        {/* ─── MAIN ────────────────────────────────────────────── */}
        <main className="main-bg flex-1">

        {/* ════ TAB: DASHBOARD ════════════════════════════════════ */}
        <div id="tab-dashboard" className="main-tab-panel active">
        <div className="av-w-page py-8">

          {/* Page title */}
          <div className="mb-8">
            <p className="eyebrow">Speaking</p>
            <h1 className="speaking-hub-title">Xin chào, <span id="greeting-name" className="text-transparent bg-clip-text" style={{ background: "linear-gradient(90deg,var(--av-primary),var(--av-info))", WebkitBackgroundClip: "text" }}>bạn</span>! 👋</h1>
            <p className="text-sm" style={{ color: "var(--av-text-muted)" }}>Hãy luyện tập thêm hôm nay để cải thiện band score của bạn.</p>
          </div>

          {/* ── PART 1: Quick Stats ──────────────────────────────── */}
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">

            <div className="stat-card rounded-2xl p-5">
              <p className="text-xs font-medium uppercase tracking-wider mb-2" style={{ color: "var(--av-text-muted)" }}>Band TB 30 ngày</p>
              <p id="stat-band" className="text-3xl font-extrabold" style={{ color: "var(--av-primary)" }}><span className="skeleton" style={{ display: "inline-block", width: "3rem", height: "1.75rem", verticalAlign: "middle" }}>&nbsp;</span></p>
              <p id="stat-band-sub" className="text-xs mt-1" style={{ color: "var(--av-text-muted)" }}>Chưa có dữ liệu</p>
            </div>

            <div className="stat-card rounded-2xl p-5">
              <p className="text-xs font-medium uppercase tracking-wider mb-2" style={{ color: "var(--av-text-muted)" }}>Tổng sessions</p>
              <p id="stat-total" className="text-3xl font-extrabold text-white"><span className="skeleton" style={{ display: "inline-block", width: "3rem", height: "1.75rem", verticalAlign: "middle" }}>&nbsp;</span></p>
              <p className="text-xs mt-1" style={{ color: "var(--av-text-muted)" }}>Kể từ khi tham gia</p>
            </div>

            <div className="stat-card rounded-2xl p-5">
              <p className="text-xs font-medium uppercase tracking-wider mb-2" style={{ color: "var(--av-text-muted)" }}>Buổi học gần nhất</p>
              <p id="stat-last-date" className="text-xl font-extrabold text-white"><span className="skeleton" style={{ display: "inline-block", width: "5rem", height: "1.25rem", verticalAlign: "middle" }}>&nbsp;</span></p>
              <p id="stat-last-topic" className="text-xs mt-1 truncate" style={{ color: "var(--av-text-muted)" }}>Chưa có buổi học nào</p>
            </div>

            <div className="stat-card rounded-2xl p-5">
              <p className="text-xs font-medium uppercase tracking-wider mb-2" style={{ color: "var(--av-text-muted)" }}>Streak hiện tại</p>
              <div className="flex items-end gap-1.5">
                <p id="stat-streak" className="text-3xl font-extrabold text-white"><span className="skeleton" style={{ display: "inline-block", width: "2.25rem", height: "1.75rem", verticalAlign: "middle" }}>&nbsp;</span></p>
                <p className="text-lg font-semibold mb-0.5" style={{ color: "var(--av-text-muted)" }}>ngày</p>
              </div>
              <p className="text-xs mt-1" style={{ color: "var(--av-text-muted)" }}>🔥 Duy trì chuỗi!</p>
            </div>

          </section>

          {/* Sprint 8.1 — "Tiếp tục luyện tập" banner (#continue-cta) retired.
               Re-entering practice now happens through the unified "Bắt đầu
               luyện tập" mode-card grid below. The session-resume affordance
               (cta-topic-label) was rarely populated and competed with the
               mode cards for attention; consolidating into one entry surface
               per Sprint 8.1 IA refactor. */}

          {/* ── Empty state (no sessions yet) ─────────────────────── */}
          <div id="dashboard-empty" className="hidden mb-10 rounded-2xl ds-empty" style={{ border: "1px dashed var(--av-border-default)" }}>
            <div className="ds-empty-icon">🎙️</div>
            <p className="ds-empty-title">Bắt đầu buổi học đầu tiên</p>
            <p className="ds-empty-sub">Hoàn thành ít nhất một session để xem thống kê và biểu đồ tiến độ.</p>
            <button id="dash-empty-start" className="btn-start text-white text-sm font-semibold px-5 py-2.5 rounded-xl">Luyện tập ngay →</button>
          </div>

          {/* ── PART 1.5: Charts ──────────────────────────────────── */}
          <section id="charts-section" className="mb-10">
            <h2 className="text-lg font-bold mb-5">Tiến độ của bạn</h2>
            <div className="grid lg:grid-cols-2 gap-4">

              {/* Line chart */}
              <div className="stat-card rounded-2xl p-5">
                <p className="ds-section-head">Band Score theo thời gian</p>
                <div id="line-chart-wrap" style={{ position: "relative", height: "220px" }}>
                  <canvas id="chart-line"></canvas>
                </div>
                <p id="line-chart-empty" className="hidden text-center text-sm py-16" style={{ color: "var(--av-text-muted)" }}>
                  Cần ít nhất 2 sessions để hiện biểu đồ
                </p>
              </div>

              {/* Radar chart */}
              <div className="stat-card rounded-2xl p-5">
                <p className="ds-section-head mb-1">Điểm mạnh yếu 4 tiêu chí
                  <span className="ml-1 normal-case font-normal" style={{ color: "var(--av-text-muted)" }}>5 sessions gần nhất</span>
                </p>
                <div id="radar-chart-wrap" style={{ position: "relative", height: "235px" }}>
                  <canvas id="chart-radar"></canvas>
                </div>
                <p id="radar-chart-empty" className="hidden text-center text-sm py-16" style={{ color: "var(--av-text-muted)" }}>
                  Biểu đồ 4 tiêu chí chỉ có ở bài <strong>Test đầy đủ</strong> (chấm FC · LR · GRA · Pronunciation).<br />
                  Bài Luyện tập chỉ có band tổng — hãy làm một bài Test để xem điểm mạnh/yếu từng tiêu chí.
                </p>
              </div>

            </div>
          </section>

          {/* ── PART 2: Mode entry cards (Sprint 8.1) ──────────── */}
          <section className="speaking-modes mb-10" aria-labelledby="modes-heading">
            <h2 id="modes-heading" className="text-lg font-bold mb-5">Bắt đầu luyện tập</h2>
            <div className="modes-grid">
              <a href="#" className="mode-card" data-mode="practice" aria-label="Mở chế độ Luyện tập">
                <div className="head">
                  <div className="icon"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="lucide lucide-target"><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></svg></div>
                  <span className="arrow" aria-hidden="true">→</span>
                </div>
                <h3>Luyện tập</h3>
                <p className="lede">Tự chọn chủ đề hoặc nhập câu hỏi riêng. Phản hồi tức thì sau mỗi câu.</p>
              </a>
              <a href="#" className="mode-card" data-mode="partbpart" aria-label="Mở chế độ Luyện từng Part">
                <div className="head">
                  <div className="icon"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="lucide lucide-list-checks"><path d="M13 5h8" /><path d="M13 12h8" /><path d="M13 19h8" /><path d="m3 17 2 2 4-4" /><path d="m3 7 2 2 4-4" /></svg></div>
                  <span className="arrow" aria-hidden="true">→</span>
                </div>
                <h3>Luyện từng Part</h3>
                <p className="lede">Đúng cấu trúc Part 1 / 2 / 3. Đánh giá 4 tiêu chí cuối buổi.</p>
              </a>
              <a href="#" className="mode-card" data-mode="fulltest" aria-label="Mở chế độ Full Test">
                <div className="head">
                  <div className="icon"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="lucide lucide-trophy"><path d="M10 14.66v1.626a2 2 0 0 1-.976 1.696A5 5 0 0 0 7 21.978" /><path d="M14 14.66v1.626a2 2 0 0 0 .976 1.696A5 5 0 0 1 17 21.978" /><path d="M18 9h1.5a1 1 0 0 0 0-5H18" /><path d="M4 22h16" /><path d="M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z" /><path d="M6 9H4.5a1 1 0 0 1 0-5H6" /></svg></div>
                  <span className="arrow" aria-hidden="true">→</span>
                </div>
                <h3>Full Test</h3>
                <p className="lede">Mô phỏng trọn vẹn IELTS Speaking Part 1 → 3 với band tổng thể.</p>
              </a>
            </div>
          </section>

          {/* ── PART 2b: Grammar Dashboard ──────────────────────── */}
          <section id="grammar-dashboard-section" className="grammar-section mb-8">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-lg font-bold">Ngữ pháp của bạn</h2>
                <p className="text-xs mt-0.5" style={{ color: "var(--av-text-muted)" }}>Dựa trên phản hồi từ các buổi luyện</p>
              </div>
              <a href="/grammar" className="text-xs font-semibold" style={{ color: "var(--av-primary)" }}>Xem tất cả →</a>
            </div>

            {/* Loading skeleton */}
            <div id="grammar-loading" className="space-y-3">
              <div className="skeleton h-4 w-32 mb-4"></div>
              <div className="flex gap-2 flex-wrap">
                <div className="skeleton h-7 w-28 rounded-full"></div>
                <div className="skeleton h-7 w-24 rounded-full"></div>
                <div className="skeleton h-7 w-32 rounded-full"></div>
              </div>
            </div>

            {/* Loaded content (hidden until data arrives) */}
            <div id="grammar-content" className="hidden space-y-6">

              {/* Focus this week */}
              <div id="grammar-focus-wrap">
                <p className="grammar-sub-title">Cần luyện tuần này</p>
                <div id="grammar-focus-pills" className="flex flex-wrap gap-2"></div>
              </div>

              {/* Weak areas */}
              <div id="grammar-weak-wrap">
                <p className="grammar-sub-title">Điểm yếu thường gặp</p>
                <div id="grammar-weak-list" className="space-y-2"></div>
              </div>

              {/* Recently viewed */}
              <div id="grammar-recent-wrap">
                <p className="grammar-sub-title">Đã xem gần đây</p>
                <div id="grammar-recent-list" className="space-y-0.5"></div>
              </div>

              {/* Saved articles */}
              <div id="grammar-saved-wrap">
                <p className="grammar-sub-title">Bài đã lưu</p>
                <div id="grammar-saved-list" className="space-y-2"></div>
              </div>

            </div>

            {/* New-user empty state */}
            <div id="grammar-empty" className="hidden text-center py-6">
              <div className="text-3xl mb-3">📚</div>
              <p className="text-sm font-semibold mb-1">Chưa có dữ liệu ngữ pháp</p>
              <p className="text-xs" style={{ color: "var(--av-text-muted)" }}>Hoàn thành một buổi luyện để nhận phản hồi ngữ pháp cá nhân hoá.</p>
            </div>
          </section>

          {/* ── PART 2c: Vocab updates — RETIRED (Phase 1, My Vocabulary removal) ──
            The "Cập nhật từ vựng gần đây" widget was removed together with the
            personal vocab bank / My Vocabulary surface. It promised a durable
            personal-vocab history whose "Xem tất cả" destination no longer exists
            (the only browse surface left, #vocab-topics, is the public topic
            browser and cannot show a user's saved/recent words). With discovery
            turned off there are also no new session-driven vocab events to show.
            renderVocabUpdates()/loadVocabUpdates() below are now dormant no-ops. */}

          {/* ── PART 3: Session history ──────────────────────────── */}
          <section>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold">Lịch sử sessions</h2>
              <span id="history-count" className="ds-badge">0 sessions</span>
            </div>

            {/* Sprint 16.3 — aggregate soft-hide warning (filled by renderHistory). */}
            <div id="history-retention-banner" className="mb-3"></div>

            {/* Search / filter / sort controls (Phase 2.5) */}
            <div id="history-filters" className="rounded-xl mb-3" style={{ background: "var(--av-surface-card)", border: "1px solid var(--av-border-subtle)", padding: "14px 16px" }}>
              <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                <input type="search" id="hf-search" placeholder="Tìm theo chủ đề…" className="text-sm rounded-lg px-3 py-2" style={{ flex: "1 1 220px", minWidth: "200px" }} />
                <select id="hf-sort" className="text-sm rounded-lg px-3 py-2">
                  <option value="newest">Mới nhất</option>
                  <option value="oldest">Cũ nhất</option>
                  <option value="score_desc">Điểm cao → thấp</option>
                  <option value="score_asc">Điểm thấp → cao</option>
                </select>
              </div>
              <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap", marginTop: "10px" }}>
                <label style={{ fontSize: "12px", color: "var(--av-text-secondary)", display: "flex", alignItems: "center", gap: "6px" }}>
                  Từ:
                  <input type="date" id="hf-date-from" className="text-xs rounded-lg px-2 py-1.5" />
                </label>
                <label style={{ fontSize: "12px", color: "var(--av-text-secondary)", display: "flex", alignItems: "center", gap: "6px" }}>
                  Đến:
                  <input type="date" id="hf-date-to" className="text-xs rounded-lg px-2 py-1.5" />
                </label>
                <button className="text-xs px-3 py-1.5 rounded-lg" style={{ background: "var(--av-primary-soft)", border: "1px solid var(--av-primary-border)", color: "var(--av-primary)" }}>
                  Lọc
                </button>
                <button className="text-xs px-3 py-1.5 rounded-lg" style={{ background: "transparent", border: "1px solid var(--av-border-default)", color: "var(--av-text-secondary)" }}>
                  Xóa lọc
                </button>
                <span id="history-filter-info" className="hidden text-xs ml-auto" style={{ color: "var(--av-text-secondary)" }}></span>
              </div>
            </div>

            {/* Table wrapper */}
            <div className="rounded-2xl overflow-hidden border" style={{ borderColor: "var(--av-border-subtle)" }}>

              {/* P2.2 skeleton — first-paint placeholder. Shown until loadHistory
                   resolves, then renderHistory() hides it and reveals empty|table.
                   Prevents the old flash where the "no sessions" empty state below
                   showed for ~1.8s even for users who DO have history. */}
              <div id="history-skeleton" className="p-5 space-y-3">
                <div className="skeleton" style={{ height: "2.25rem", borderRadius: "var(--av-radius-md)" }}></div>
                <div className="skeleton" style={{ height: "2.25rem", borderRadius: "var(--av-radius-md)" }}></div>
                <div className="skeleton" style={{ height: "2.25rem", borderRadius: "var(--av-radius-md)" }}></div>
              </div>

              {/* Empty state (hidden until loadHistory confirms zero sessions) */}
              <div id="history-empty" className="ds-empty hidden">
                <div className="ds-empty-icon">📭</div>
                <p className="ds-empty-title">Bạn chưa có session nào.</p>
                <p className="ds-empty-sub">Hoàn thành buổi luyện đầu tiên để theo dõi tiến độ.</p>
                <button id="grammar-cta-start" className="btn-start text-white text-sm font-semibold px-6 py-2.5 rounded-xl">
                  Bắt đầu ngay →
                </button>
              </div>

              {/* Table (hidden until data loaded) */}
              <div id="history-table-wrap" className="hidden overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: "var(--av-surface-sunken)", borderBottom: "1px solid var(--av-border-subtle)" }}>
                      <th className="text-left px-5 py-3.5 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--av-text-muted)" }}>Ngày</th>
                      <th className="text-left px-5 py-3.5 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--av-text-muted)" }}>Part</th>
                      <th className="text-left px-5 py-3.5 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--av-text-muted)" }}>Chế độ</th>
                      <th className="text-left px-5 py-3.5 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--av-text-muted)" }}>Chủ đề</th>
                      <th className="text-center px-5 py-3.5 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--av-text-muted)" }}>Band</th>
                      <th className="text-center px-5 py-3.5 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--av-text-muted)" }}>Xem lại</th>
                    </tr>
                  </thead>
                  <tbody id="history-tbody" style={{ borderTop: "1px solid var(--av-border-subtle)" }}></tbody>
                </table>
              </div>

            </div>

            {/* Pagination (Phase 2.5) — hidden when no filters applied */}
            <div id="history-pagination" className="hidden mt-4" style={{ display: "none", justifyContent: "center", alignItems: "center", gap: "8px", fontSize: "13px", color: "var(--av-text-secondary)" }}></div>
          </section>

        </div>{/* /inner padding wrapper */}
        </div>{/* /tab-dashboard */}


        {/* ════ TAB: PRACTICE ═════════════════════════════════════ */}
        <div id="tab-practice" className="main-tab-panel">
        <div className="av-w-page py-8">

          <header className="subpage-header mb-2">
            <div className="subpage-header__lhs">
              <button type="button" className="subpage-header__back" data-action="back-to-dashboard" aria-label="Quay về dashboard Speaking">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="lucide lucide-arrow-left"><path d="m12 19-7-7 7-7" /><path d="M19 12H5" /></svg>
                <span>Speaking</span>
              </button>
              <span className="subpage-header__sep">|</span>
              <h1 className="subpage-header__title">Luyện tập</h1>
            </div>
          </header>
          <p className="text-sm mb-8" style={{ color: "var(--av-text-muted)" }}>Nhập câu hỏi của bạn hoặc chọn chủ đề từ thư viện để luyện nói.</p>

          <div className="grid md:grid-cols-2 gap-6">

            {/* Option A: Custom question(s) */}
            <div className="option-card flex flex-col">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0" style={{ background: "rgba(15,118,110,0.2)" }}>✍️</div>
                <div>
                  <h3 className="font-bold text-sm">Câu hỏi tùy chỉnh</h3>
                  <p className="text-xs" style={{ color: "var(--av-text-muted)" }}>Nhập câu hỏi — bỏ qua bước AI tạo</p>
                </div>
              </div>

              <div className="mb-3">
                <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--av-text-muted)" }}>
                  Câu hỏi
                </label>

                {/* Sprint 14.6.2 — Andy 2026-05-22 — retired the Sprint 14.4
                     three-option toggle. Part 1/2/3 button below already drives
                     the mode; the toggle was redundant cognitive load per
                     Andy's screenshot. Format hint replaces it. */}
                <textarea id="prac-custom-q" rows={5} className="tab-input" style={{ resize: "vertical", minHeight: "110px" }} placeholder="Ví dụ:&#10;Do you enjoy spending time outdoors?&#10;How has technology changed your daily life?&#10;Describe a memorable experience." maxLength={2000}></textarea>

                <p id="prac-custom-q-hint" className="cue-card-form-hint text-xs" style={{ marginTop: "6px", color: "var(--av-text-muted)" }}>
                  Part 1 / 3: mỗi dòng một câu (tối đa 10). Part 2: paste cue card đầy đủ, hoặc nhập 1 dòng để AI tạo cue card.
                </p>

                {/* Sprint 14.6.4 — Part-2-only length warning. Visible
                     state is driven by `data-state` so the rule lives in
                     ds.css (Pattern #26: no inline color/bg literals). */}
                <div id="prac-custom-q-length-warning" className="ds-cuecard-length-warning" data-state="hidden" role="status" aria-live="polite"></div>

                <p id="prac-custom-q-preview" className="cue-card-preview" style={{ display: "none", fontSize: "11px", marginTop: "6px", color: "var(--av-text-muted)" }}></p>
              </div>

              <div className="mb-3">
                <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--av-text-muted)" }}>Part (để xác định ngữ cảnh)</label>
                <div className="flex gap-2">
                  <button className="part-select-btn selected" id="prac-part-1">Part 1</button>
                  <button className="part-select-btn" id="prac-part-2">Part 2</button>
                  <button className="part-select-btn" id="prac-part-3">Part 3</button>
                </div>
              </div>

              <p id="prac-custom-q-error" className="tab-error"></p>
              <button id="prac-custom-q-start" className="btn-confirm mt-auto">✍️ Bắt đầu luyện tập</button>
            </div>

            {/* Option B: Topic from library */}
            <div className="option-card flex flex-col">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0" style={{ background: "rgba(15,118,110,0.2)" }}>📚</div>
                <div>
                  <h3 className="font-bold text-sm">Chủ đề từ thư viện</h3>
                  <p className="text-xs" style={{ color: "var(--av-text-muted)" }}>AI tạo câu hỏi theo chủ đề</p>
                </div>
              </div>

              <div className="mb-3">
                <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--av-text-muted)" }}>Chọn Part</label>
                <div className="flex gap-2">
                  <button className="part-select-btn selected" id="prac-tp-part-1">Part 1</button>
                  <button className="part-select-btn" id="prac-tp-part-2">Part 2</button>
                  <button className="part-select-btn" id="prac-tp-part-3">Part 3</button>
                </div>
              </div>

              <div className="mb-3">
                <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--av-text-muted)" }}>Chủ đề từ thư viện</label>
                <div style={{ position: "relative" }}>
                  <select id="prac-topic-select" className="tab-input" style={{ appearance: "none", paddingRight: "36px" }}>
                    <option value="" disabled selected>— Chọn tab để tải... —</option>
                  </select>
                  <span style={{ position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "var(--av-text-muted)" }}>▾</span>
                </div>
              </div>

              <div className="mb-3">
                <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--av-text-muted)" }}>Hoặc nhập chủ đề tự do</label>
                <input id="prac-topic-custom" type="text" className="tab-input" placeholder="Ví dụ: AI technology, Work-life balance..." maxLength={120} />
              </div>

              <p id="prac-topic-error" className="tab-error"></p>
              <button id="prac-topic-start" className="btn-confirm mt-auto">🚀 Bắt đầu tạo câu hỏi</button>
            </div>

          </div>
        </div>
        </div>{/* /tab-practice */}


        {/* ════ TAB: PART-BY-PART ═════════════════════════════════ */}
        <div id="tab-partbpart" className="main-tab-panel">
        <div className="av-w-page py-8">

          <header className="subpage-header mb-2">
            <div className="subpage-header__lhs">
              <button type="button" className="subpage-header__back" data-action="back-to-dashboard" aria-label="Quay về dashboard Speaking">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="lucide lucide-arrow-left"><path d="m12 19-7-7 7-7" /><path d="M19 12H5" /></svg>
                <span>Speaking</span>
              </button>
              <span className="subpage-header__sep">|</span>
              <h1 className="subpage-header__title">Luyện từng Part</h1>
            </div>
          </header>
          <p className="text-sm mb-8" style={{ color: "var(--av-text-muted)" }}>Chọn Part để luyện tập có cấu trúc đầy đủ số câu hỏi theo IELTS.</p>

          {/* Part cards */}
          <div className="grid sm:grid-cols-3 gap-4 mb-6">

            <div className="pbp-part-card" id="pbp-card-1">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0" style={{ background: "rgba(15,118,110,0.2)" }}>💬</div>
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--av-primary)" }}>Part 1</span>
                  <h3 className="font-bold text-sm leading-tight">Introduction &amp; Interview</h3>
                </div>
              </div>
              <p className="text-xs leading-relaxed" style={{ color: "var(--av-text-muted)" }}>
                3 câu hỏi về chủ đề quen thuộc. Phản hồi coaching chi tiết.
              </p>
              <p className="text-xs mt-2" style={{ color: "var(--av-text-muted)" }}>⏱ 4–5 phút</p>
            </div>

            <div className="pbp-part-card" id="pbp-card-2">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0" style={{ background: "rgba(15,118,110,0.2)" }}>🗒️</div>
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--av-primary)" }}>Part 2</span>
                  <h3 className="font-bold text-sm leading-tight">Individual Long Turn</h3>
                </div>
              </div>
              <p className="text-xs leading-relaxed" style={{ color: "var(--av-text-muted)" }}>
                1 cue card, nói 2 phút sau 1 phút chuẩn bị.
              </p>
              <p className="text-xs mt-2" style={{ color: "var(--av-text-muted)" }}>⏱ 3–4 phút</p>
            </div>

            <div className="pbp-part-card" id="pbp-card-3">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0" style={{ background: "rgba(15,118,110,0.2)" }}>🧠</div>
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--av-primary)" }}>Part 3</span>
                  <h3 className="font-bold text-sm leading-tight">Two-way Discussion</h3>
                </div>
              </div>
              <p className="text-xs leading-relaxed" style={{ color: "var(--av-text-muted)" }}>
                3 câu hỏi thảo luận chuyên sâu về vấn đề xã hội.
              </p>
              <p className="text-xs mt-2" style={{ color: "var(--av-text-muted)" }}>⏱ 4–5 phút</p>
            </div>

          </div>

          {/* Topic section (revealed after part selection) */}
          <div id="pbp-topic-section" style={{ display: "none" }}>
            <div className="option-card">
              <h3 id="pbp-part-label" className="font-bold text-sm mb-4" style={{ color: "var(--av-primary)" }}>Chọn chủ đề</h3>

              <div className="grid md:grid-cols-2 gap-4 mb-3">
                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--av-text-muted)" }}>Từ thư viện</label>
                  <div style={{ position: "relative" }}>
                    <select id="pbp-topic-select" className="tab-input" style={{ appearance: "none", paddingRight: "36px" }}>
                      <option value="" disabled selected>— Đang tải... —</option>
                    </select>
                    <span style={{ position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "var(--av-text-muted)" }}>▾</span>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--av-text-muted)" }}>Hoặc nhập chủ đề tự do</label>
                  <input id="pbp-topic-custom" type="text" className="tab-input" placeholder="Ví dụ: Social media, Climate change..." maxLength={120} />
                </div>
              </div>

              <p id="pbp-error" className="tab-error"></p>
              <button id="pbp-start" className="btn-confirm w-full mt-2">🚀 Bắt đầu luyện tập</button>
            </div>
          </div>

        </div>
        </div>{/* /tab-partbpart */}


        {/* ════ TAB: FULL TEST ═════════════════════════════════════ */}
        <div id="tab-fulltest" className="main-tab-panel">
        <div className="av-w-page py-8">

          <header className="subpage-header mb-2">
            <div className="subpage-header__lhs">
              <button type="button" className="subpage-header__back" data-action="back-to-dashboard" aria-label="Quay về dashboard Speaking">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="lucide lucide-arrow-left"><path d="m12 19-7-7 7-7" /><path d="M19 12H5" /></svg>
                <span>Speaking</span>
              </button>
              <span className="subpage-header__sep">|</span>
              <h1 className="subpage-header__title">Full Test</h1>
            </div>
          </header>
          <p className="text-sm mb-8" style={{ color: "var(--av-text-muted)" }}>Mô phỏng kỳ thi IELTS Speaking thật: Part 1 → Part 2 → Part 3 liên tiếp.</p>

          {/* Info banner */}
          <div className="mb-6 rounded-2xl px-5 py-4 flex items-start gap-3" style={{ background: "rgba(14,165,233,0.08)", border: "1px solid rgba(14,165,233,0.2)" }}>
            <span className="text-lg flex-shrink-0">🔊</span>
            <div>
              <p className="text-sm font-semibold mb-1" style={{ color: "var(--av-info)" }}>Chế độ Listening (mặc định)</p>
              <p className="text-xs leading-relaxed" style={{ color: "var(--av-text-secondary)" }}>
                Câu hỏi sẽ được đọc to bởi AI (giọng nói tự nhiên). Văn bản câu hỏi ẩn mặc định — bạn có thể bật hiển thị bất cứ lúc nào. Đánh giá theo 4 tiêu chí IELTS: FC, LR, GRA, Pronunciation.
              </p>
            </div>
          </div>

          <div className="space-y-4 mb-6">

            {/* Part 1 */}
            <div className="ft-part-row">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-base flex-shrink-0" style={{ background: "rgba(15,118,110,0.2)" }}>💬</div>
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--av-primary)" }}>Part 1</span>
                  <span className="text-xs ml-2" style={{ color: "var(--av-text-secondary)" }}>3 chủ đề × 3 câu = 9 câu</span>
                </div>
              </div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--av-text-muted)" }}>
                3 chủ đề <span style={{ color: "var(--av-text-secondary)" }}>(tùy chọn — để trống = ngẫu nhiên từ thư viện)</span>
              </label>
              <div className="space-y-2">
                <input id="ft-p1-topic-1" type="text" className="tab-input" placeholder="Chủ đề 1 — Ví dụ: Daily Life &amp; Hobbies" maxLength={120} />
                <input id="ft-p1-topic-2" type="text" className="tab-input" placeholder="Chủ đề 2 — Ví dụ: Technology" maxLength={120} />
                <input id="ft-p1-topic-3" type="text" className="tab-input" placeholder="Chủ đề 3 — Ví dụ: Travel &amp; Transport" maxLength={120} />
              </div>
            </div>

            {/* Part 2 */}
            <div className="ft-part-row">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-base flex-shrink-0" style={{ background: "rgba(15,118,110,0.2)" }}>🗒️</div>
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--av-primary)" }}>Part 2</span>
                  <span className="text-xs ml-2" style={{ color: "var(--av-text-secondary)" }}>1 cue card</span>
                </div>
              </div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--av-text-muted)" }}>
                Chủ đề <span style={{ color: "var(--av-text-secondary)" }}>(tùy chọn — để trống = ngẫu nhiên từ thư viện)</span>
              </label>
              <input id="ft-p2-topic" type="text" className="tab-input" placeholder="Ví dụ: A person you admire, A memorable journey..." maxLength={120} />
            </div>

            {/* Part 3 */}
            <div className="ft-part-row" style={{ opacity: "0.7" }}>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-base flex-shrink-0" style={{ background: "rgba(15,118,110,0.2)" }}>🧠</div>
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--av-primary)" }}>Part 3</span>
                  <span className="text-xs ml-2" style={{ color: "var(--av-text-secondary)" }}>5 câu hỏi</span>
                </div>
              </div>
              <p className="text-xs mt-2" style={{ color: "var(--av-text-muted)" }}>
                Tự động tạo từ chủ đề Part 2 — không cần nhập.
              </p>
            </div>

          </div>

          <p id="ft-error" className="tab-error mb-3"></p>
          <button id="ft-start" className="btn-fulltest w-full rounded-2xl py-4 font-bold text-base tracking-wide">
            🏆 Bắt đầu Full Test
          </button>

        </div>
        </div>{/* /tab-fulltest */}


        </main>

        {/* ─── TOPIC MODAL ──────────────────────────────────────────────── */}
        <div id="topic-modal" className="modal-backdrop">
          <div className="modal-box">

            {/* Header */}
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-bold text-base">Chọn chủ đề luyện tập</h2>
              <button id="modal-close" className="w-8 h-8 flex items-center justify-center rounded-full transition" style={{ background: "var(--av-surface-card)", color: "var(--av-text-secondary)" }}>✕</button>
            </div>

            {/* Subtitle */}
            <p id="modal-subtitle" className="text-sm mb-5" style={{ color: "var(--av-text-secondary)" }}>
              Bạn muốn luyện tập Part 1 với chủ đề nào?
            </p>

            {/* Tabs */}
            <div className="flex gap-1.5 mb-5 p-1 rounded-xl" style={{ background: "var(--av-surface-sunken)" }}>
              <button id="tab-list" className="topic-tab active">
                📚 Chọn từ danh sách
              </button>
              <button id="tab-custom" className="topic-tab">
                ✏️ Tự nhập chủ đề
              </button>
              <button id="tab-myq" className="topic-tab">
                ✍️ Câu hỏi riêng
              </button>
            </div>

            {/* Panel: Chọn từ danh sách */}
            <div id="panel-list">
              <label className="block text-xs font-medium mb-2" style={{ color: "var(--av-text-muted)" }}>Chủ đề đề xuất</label>
              <div id="topic-select-wrap" style={{ position: "relative" }}>
                <select id="topic-select" className="topic-input" style={{ appearance: "none", paddingRight: "36px" }}>
                  <option value="" disabled selected>— Đang tải danh sách... —</option>
                </select>
                <span style={{ position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "var(--av-text-muted)" }}>▾</span>
              </div>
            </div>

            {/* Panel: Tự nhập */}
            <div id="panel-custom" className="hidden">
              <label className="block text-xs font-medium mb-2" style={{ color: "var(--av-text-muted)" }}>Nhập chủ đề của bạn</label>
              <input id="topic-custom-input" type="text" className="topic-input" placeholder="Ví dụ: AI technology, Fast food, Work-life balance..." maxLength={120} />
            </div>

            {/* Panel: Câu hỏi riêng */}
            <div id="panel-myq" className="hidden">
              <label className="block text-xs font-medium mb-2" style={{ color: "var(--av-text-muted)" }}>Nhập câu hỏi của bạn</label>

              {/* Sprint 14.6.2 — Sprint 14.4 toggle retired. Part 1/2/3
                   button drives the mode; format hint below replaces the
                   three-option radio group. */}
              <textarea id="myq-input" rows={5} className="topic-input" style={{ resize: "vertical", minHeight: "100px" }} placeholder="Ví dụ:&#10;Do you enjoy spending time outdoors?&#10;How has technology changed your daily life?&#10;Describe a memorable trip you have taken." maxLength={2000}></textarea>
              <p id="myq-input-hint" className="cue-card-form-hint text-xs mt-1.5" style={{ color: "var(--av-text-muted)" }}>
                Part 1 / 3: mỗi dòng một câu (tối đa 10). Part 2: paste cue card đầy đủ, hoặc nhập 1 dòng để AI tạo cue card.
              </p>
              {/* Sprint 14.6.4 — Part-2-only length warning (same shape as the
                   practice form). */}
              <div id="myq-input-length-warning" className="ds-cuecard-length-warning" data-state="hidden" role="status" aria-live="polite"></div>
              <p id="myq-input-preview" className="cue-card-preview" style={{ display: "none", fontSize: "11px", marginTop: "6px", color: "var(--av-text-muted)" }}></p>
            </div>

            {/* Error */}
            <p id="modal-error" className="modal-error"></p>

            {/* Confirm */}
            <button id="btn-confirm" className="btn-confirm mt-4">
              🚀 Bắt đầu tạo câu hỏi
            </button>

          </div>
        </div>

        {/* ─── SCRIPTS: order matters — supabase CDN → api.js → inline ── */}






        {/* Sprint 14.4 — Andy 2026-05-22 — cue card heuristic + parser.
             Pure functions (no DOM); exposed via window.CueCardDetector. */}

        {/* Sprint 16.3 — retention soft-hide warning chips + banner (pure consumers
             of the Sprint 16.2 `retention` block on GET /sessions rows). */}



          {/* Chú thích của bản legacy về hydrate icon lucide đã BỎ: nó mô tả một
               khối script không tồn tại ở bản Next, và cách làm đó không dùng
               được ở đây. Trang này NHÚNG THẲNG SVG mà lucide sinh ra và bỏ
               thuộc tính data-lucide — vì lucide@1.17.0 TỰ thay mọi phần tử
               [data-lucide] khi script nạp xong, đua với hydrate của React rồi
               ném React #418. Đo ngay trên vỏ này: 2/2 lỗi trước khi thay, 3/3
               sạch sau. Chốt chặn tests/no-lucide-in-react-tree.test.mjs chính
               là thứ bắt được chỗ này. */}
        {/* Renders any <i data-lucide="..."> elements in the page. The
             Lucide CDN script is loaded with `defer` in <head>, so the
             global `lucide` may or may not be present by the time this
             runs — the listener is the safe fallback. */}


        {/* ── Chart re-render on theme flip (Sprint 6.4.1 / kept Sprint 7.12) ──
             Theme toggle binding moved into <aver-chrome>. Charts
             (#chart-line, #chart-radar) read --av-* tokens via getComputedStyle
             in renderCharts(); when the page-level [data-theme] flips, refresh
             so axes/grid/tooltip colors swap. The dashboard module exposes a
             refresh hook on window._dashboard for exactly this. */}

    </>
  );
}
