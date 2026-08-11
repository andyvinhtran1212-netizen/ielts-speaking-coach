// Vỏ tĩnh của trang Writing Dashboard — chép TRUNG THỰC từ `public/pages/writing-dashboard.html`.
//
// VỈ SAO CHÉP NGUYÊN CLASS/ID THAY VÌ "VIẾT LẠI CHO ĐẸP": bài học pilot 2 (#741)
// — dựng lại từ đầu làm gãy cascade CSS và chỉ phát hiện được nhờ so ảnh chụp.
// Ở đây còn một ràng buộc mạnh hơn: tầng hành vi (PR sau) với tay vào DOM theo **id**
// và **class**, giống khuôn `home-behavior.tsx` + `speaking-behavior.tsx`. Trang này
// có ~60+ id riêng biệt; đổi tên bất kỳ chỗ nào là hỏng cả hai bản.
//
// ICON LUCIDE NHÚNG THẲNG, KHÔNG DÙNG `data-lucide` — CÓ CHỦ Ý.
//
// lucide@1.17.0 TỰ thay mọi `[data-lucide]` bằng `<svg>` ngay khi script nạp xong
// — KHÔNG qua `window.lucide.createIcons()`. Nên bỏ lời gọi trong layout là vô ích;
// chừng nào còn `data-lucide` trong cây React thì còn đua với hydrate React: nếu
// lucide (defer, CDN) thắng, React quay lại thấy `<svg>` ở chỗ nó vừa dựng `<i>`
// → Minified React error #418, cả cây bị dựng lại phía client. `suppressHydrationWarning`
// KHÔNG cứu được: nó chỉ che khác biệt thuộc-tính/text, không che việc con bị đổi
// hẳn loại thẻ. SVG dưới đây chép NGUYÊN VĂN cái lucide@1.17.0 sinh ra, chỉ BỎ
// thuộc tính `data-lucide` để lucide không nhận diện nữa.

export function WritingShell() {
  return (
    <>
      {/* `<aver-chrome>` KHÔNG dựng ở đây — `page.tsx` dựng nó, y như
          `(authed-speaking)`. Bản đầu của tệp này chép thẳng thẻ từ trang legacy
          nên trang ra HAI thanh điều hướng: hai user pill, hai lần đăng ký luật
          prefetch, hai lượt hỏi người dùng. Codex bắt ở #950.

          Phép so markup của tôi KHÔNG thấy được: `<aver-chrome>` dựng nội dung
          trong Shadow DOM, nên nó không thêm id nào và không thêm dòng văn bản
          nào vào HTML — hai lượt đếm "80/80 id, 981/981 dòng" đều mù với nó.
          Muốn thấy thì phải đếm chính thẻ đó. */}

      <main className="shell">

        {/* Greeting — P0-3 LCP fix. Rendered OUTSIDE #content (always visible)
             so the LCP h1 paints at the CSS/font floor (~1s) instead of waiting
             for the data chain (auth + my-assignments + my-essays + permissions)
             that reveals #content (~7.6s before). Name/code fill progressively
             via renderStudent() once loadEssays/loadAssignments resolve; the
             placeholders default to renderStudent's own no-data fallbacks. */}
        <section className="mb-8">
          <p className="eyebrow">Writing</p>
          <h1 className="text-2xl md:text-3xl font-semibold mb-2">
            Chào em, <span id="greeting-name">em</span> 👋
          </h1>
          <p className="text-sm text-gray-300">
            Mã học viên: <span id="student-code" className="font-mono text-gray-200">—</span>
            <span id="target-band-section" className="hidden">
              <span className="text-gray-500 mx-2">·</span>
              Mục tiêu: Band <span id="target-band">—</span>
            </span>
          </p>
        </section>

        {/* Loading state (kept for JS compat; hidden by default — content is always visible) */}
        <div id="loading" className="hidden text-center py-16" role="status" aria-live="polite">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-2 border-teal-light border-t-transparent"></div>
          <p className="mt-3 text-gray-300">Đang tải...</p>
        </div>

        {/* Error state */}
        <div id="error" className="hidden max-w-md mx-auto text-center py-16">
          <div className="wd-error-box">
            <p className="wd-error-box__msg" id="error-message"></p>
            <a id="error-cta"
               href="../index.html"
               className="inline-block text-teal-light underline hover:text-white transition">
              Quay về trang chủ
            </a>
          </div>
        </div>

        {/* Main content */}
        <div id="content">
          {/* Sprint 5.2 — Writing permission preview banner (hidden by default,
               revealed when GET /api/student/permissions returns writing=false). */}
          <div id="writing-preview-banner" className="wd-preview-banner hidden mb-6 flex items-start gap-3">
            <span className="wd-preview-banner__icon" aria-hidden="true">🔒</span>
            <div className="text-sm">
              <strong className="wd-preview-banner__title block mb-1">Chế độ xem trước</strong>
              <p className="wd-preview-banner__body">
                Quyền Writing chưa được kích hoạt cho tài khoản này. Em vẫn có thể xem
                các bài đã nộp trước đây — liên hệ giảng viên để được kích hoạt
                tính năng nộp bài mới.
              </p>
            </div>
          </div>

          {/* Phase 2.3b — tab nav */}
          <div className="flex border-b border-white/10 mb-6 gap-1">
            <button id="tab-assignments" type="button" className="tab-btn active">
              📋 Bài giao
              <span id="assignments-count" className="ml-1 text-xs text-gray-500"></span>
            </button>
            <button id="tab-essays" type="button" className="tab-btn">
              📝 Bài đã nộp
              <span id="essays-count" className="ml-1 text-xs text-gray-500"></span>
            </button>
            <button id="tab-tips" type="button" className="tab-btn">
              💡 Mẹo viết
            </button>
            {/* R1 — "Kho đề": hidden until the prompt-bank endpoint returns enabled:true */}
            <button id="tab-prompt-bank" type="button" className="tab-btn" hidden>
              📚 Kho đề
            </button>
          </div>

          {/* Tab 1 — Bài giao (active assignments awaiting submission) */}
          <section id="content-assignments">
            {/* Deliverable 2 (Sprint 19.1A) — "Bài sắp đến hạn" surface.
                 Built client-side from the active assignments that carry a
                 deadline, sorted soonest-first with an urgency colour cue.
                 Hidden when no active assignment has a deadline. */}
            <div id="deadlines-surface" className="wd-deadlines hidden" aria-label="Bài sắp đến hạn">
              <h2 className="wd-deadlines__title">⏰ Bài sắp đến hạn</h2>
              <div id="deadlines-list" className="wd-deadlines__list"></div>
            </div>

            <div id="assignments-list" className="space-y-3"><p className="text-sm py-8 text-center" style={{color:'var(--av-text-muted)'}}>Đang tải…</p></div>
            <div id="assignments-empty" className="wd-empty hidden">
              <div className="wd-empty__icon" aria-hidden="true">📋</div>
              <p className="wd-empty__title">Em chưa có bài giao nào</p>
              <p className="wd-empty__hint">Khi giảng viên giao đề, em sẽ thấy ở đây.</p>
            </div>
          </section>

          {/* Tab 2 — Bài đã nộp (existing essays list) */}
          <section id="content-essays" className="hidden">
            {/* Sprint 2.5.5: 4 status filter sub-tabs */}
            <nav id="essay-filter-tabs" className="flex gap-1 mb-4 border-b border-white/5 pb-1 overflow-x-auto"
                 aria-label="Lọc bài viết theo trạng thái">
              <button type="button" className="essay-filter-btn is-active" data-filter="all">
                <span className="filter-label">Tất cả</span>
                <span className="filter-count" id="filter-count-all">—</span>
              </button>
              <button type="button" className="essay-filter-btn" data-filter="delivered">
                <span className="filter-label">✓ Đã chấm</span>
                <span className="filter-count" id="filter-count-delivered">—</span>
              </button>
              <button type="button" className="essay-filter-btn" data-filter="pending">
                <span className="filter-label">⏳ Chờ chấm</span>
                <span className="filter-count" id="filter-count-pending">—</span>
              </button>
              <button type="button" className="essay-filter-btn" data-filter="flagged">
                <span className="filter-label">🚩 Bị đánh dấu</span>
                <span className="filter-count" id="filter-count-flagged">—</span>
              </button>
            </nav>
            <div id="essays-list" className="space-y-3"><p className="text-sm py-8 text-center" style={{color:'var(--av-text-muted)'}}>Đang tải…</p></div>
            <div id="empty-state" className="wd-empty hidden">
              <div className="wd-empty__icon" aria-hidden="true">📝</div>
              <p className="wd-empty__title">Em chưa có bài viết nào</p>
              <p className="wd-empty__hint">Hãy nộp bài đầu tiên qua thẻ "Bài giao" hoặc qua giảng viên của em.</p>
            </div>
            <div id="filter-empty-state" className="wd-empty wd-empty--compact hidden">
              <p className="wd-empty__hint">Không có bài nào trong nhóm này.</p>
            </div>
          </section>

          {/* Tab 3 — Mẹo viết (Sprint 19.1B: admin-published writing tips) */}
          <section id="content-tips" className="hidden">
            <nav id="tips-filter-tabs" className="flex gap-1 mb-4 border-b border-white/5 pb-1 overflow-x-auto"
                 aria-label="Lọc mẹo theo loại task">
              <button type="button" className="essay-filter-btn is-active" data-tip-filter="all">
                <span className="filter-label">Tất cả</span>
              </button>
              <button type="button" className="essay-filter-btn" data-tip-filter="task_1">
                <span className="filter-label">Task 1</span>
              </button>
              <button type="button" className="essay-filter-btn" data-tip-filter="task_2">
                <span className="filter-label">Task 2</span>
              </button>
              <button type="button" className="essay-filter-btn" data-tip-filter="both">
                <span className="filter-label">Cả hai</span>
              </button>
            </nav>
            {/* Sprint 19.1C — content_type filter (2nd axis: AND with task) */}
            <nav id="tips-type-tabs" className="flex gap-1 mb-4 overflow-x-auto"
                 aria-label="Lọc theo loại nội dung">
              <button type="button" className="essay-filter-btn is-active" data-tip-type-filter="all">
                <span className="filter-label">Tất cả</span>
              </button>
              <button type="button" className="essay-filter-btn" data-tip-type-filter="tip">
                <span className="filter-label">💡 Mẹo</span>
              </button>
              <button type="button" className="essay-filter-btn" data-tip-type-filter="knowledge">
                <span className="filter-label">📖 Kiến thức</span>
              </button>
              <button type="button" className="essay-filter-btn" data-tip-type-filter="sample">
                <span className="filter-label">✍️ Bài mẫu</span>
              </button>
              <button type="button" className="essay-filter-btn" data-tip-type-filter="outline">
                <span className="filter-label">🗂️ Dàn bài</span>
              </button>
            </nav>
            <div id="tips-loading" className="text-center py-10 text-gray-300">Đang tải mẹo…</div>
            <div id="tips-list" className="space-y-3 hidden"></div>
            <div id="tips-empty" className="wd-empty hidden">
              <div className="wd-empty__icon" aria-hidden="true">💡</div>
              <p className="wd-empty__title">Chưa có mẹo nào</p>
              <p className="wd-empty__hint">Giảng viên sẽ publish mẹo viết sớm — em quay lại sau nhé.</p>
            </div>
            <div id="tips-error" className="wd-empty wd-empty--compact hidden">
              <p className="wd-empty__hint" id="tips-error-msg">Không tải được mẹo viết.</p>
            </div>
          </section>

          {/* Tab 4 — Kho đề (R1: public prompt-bank browse, flag-gated). Browse-only. */}
          <section id="content-prompt-bank" className="hidden">
            <nav id="pb-filter-tabs" className="flex gap-1 mb-4 border-b border-white/5 pb-1 overflow-x-auto"
                 aria-label="Lọc đề theo loại task">
              <button type="button" className="essay-filter-btn is-active" data-pb-filter="all">
                <span className="filter-label">Tất cả</span>
              </button>
              <button type="button" className="essay-filter-btn" data-pb-filter="task1_academic">
                <span className="filter-label">Task 1 Academic</span>
              </button>
              <button type="button" className="essay-filter-btn" data-pb-filter="task1_general">
                <span className="filter-label">Task 1 General</span>
              </button>
              <button type="button" className="essay-filter-btn" data-pb-filter="task2">
                <span className="filter-label">Task 2</span>
              </button>
            </nav>
            <div id="pb-list" className="space-y-3"></div>
          </section>
        </div>
      </main>

      {/* Tip detail modal (Sprint 19.1B) — renders the sanitized markdown body. */}
      <div id="tip-modal" className="wd-tip-modal hidden fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="tip-modal-title">
        <div className="wd-tip-modal__backdrop" id="tip-modal-backdrop"></div>
        <div className="wd-tip-modal__panel">
          <header className="flex items-start justify-between gap-3 mb-3">
            <div className="min-w-0">
              <h2 id="tip-modal-title" className="text-xl font-semibold"></h2>
              <p id="tip-modal-meta" className="text-xs text-gray-400 mt-1"></p>
            </div>
            <button id="tip-modal-close" type="button" className="wd-modal-close leading-none" aria-label="Đóng">
              {/* lucide@1.17.0 tự thay icon X — nhúng thẳng SVG để tránh đua React #418 */}
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="lucide lucide-x"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
            </button>
          </header>
          <div id="tip-modal-body" className="md-body"></div>
        </div>
      </div>

      {/* Sprint 2.6.1 — full-screen submit modal.
          Replaces the inline form-region that lived inside each card.
          The modal renders the prompt + image + textarea + footer; one
          instance reused across every assignment.

          `data-gramm` / `data-gramm_editor` / `data-enable-grammarly` are
          the documented opt-out attributes for the Grammarly extension.
          Combined with `spellcheck="false"`, `autocorrect="off"`, and
          `autocomplete="off"` they form the strongest browser-side
          defence we have against IDE-style "help" leaking into a timed
          IELTS exercise. */}
      <div id="submit-modal" className="wd-submit-modal hidden fixed inset-0 z-50 overflow-y-auto"
           role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="wd-compose-page av-w-page">
          <header className="wd-compose-header">
            <div className="wd-compose-heading">
              <span className="wd-compose-kicker">Writing workspace</span>
              <h1 id="modal-title">Làm bài</h1>
              <p>Đọc kỹ đề, viết liền mạch và kiểm tra lại trước khi nộp.</p>
            </div>
            <button id="modal-close" type="button"
                    className="wd-modal-close leading-none"
                    aria-label="Đóng bài viết và quay lại danh sách">
              {/* lucide@1.17.0 tự thay icon X — nhúng thẳng SVG để tránh đua React #418 */}
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="lucide lucide-x"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
            </button>
          </header>

          <div id="modal-loading" className="wd-modal-loading text-center py-12">Đang tải…</div>

          <div id="modal-content" className="hidden">
            {/* W-UI 2-pane: đề bài (TRÁI, scrollable) · khung viết (PHẢI).
                 Task 1 widens the prompt pane when a chart is present.
                 Mobile (≤860px) stacks: đề trên / viết dưới. */}
            <div id="modal-workspace" className="wd-modal-2pane">

              {/* ── LEFT — đề bài ───────────────────────────────────────── */}
              <aside className="wd-modal-pane-left" aria-label="Đề bài">
                {/* Prompt panel */}
                <div className="wd-modal-prompt-panel">
                  <div className="wd-modal-section-label">Đề bài</div>
                  <div className="wd-modal-prompt__meta" id="modal-prompt-meta">— · —</div>
                  <h2 className="wd-modal-prompt__title" id="modal-prompt-title">—</h2>
                  {/* W-UI follow-up — đề (prompt_text) ABOVE the Task-1 chart so the
                       question reads first, then the chart it refers to. */}
                  <p className="wd-modal-prompt__body whitespace-pre-line" id="modal-prompt-text">—</p>
                  <img id="modal-prompt-image" className="wd-modal-prompt__image hidden"
                       alt="Biểu đồ hoặc hình minh họa của đề Writing Task 1" loading="lazy" />
                </div>

                {/* Optional admin instructions */}
                <div id="modal-instructions" className="wd-modal-instructions hidden">
                  <strong>Lưu ý từ giảng viên</strong>
                  <span id="modal-instructions-text"></span>
                </div>
                <div className="wd-prompt-checklist" aria-label="Các bước trước khi nộp">
                  <span>1</span><p>Trả lời đúng trọng tâm đề.</p>
                  <span>2</span><p>Kiểm tra bố cục và số từ.</p>
                  <span>3</span><p>Đọc lại một lượt trước khi nộp.</p>
                </div>
              </aside>

              {/* ── RIGHT — khung viết ──────────────────────────────────── */}
              <section className="wd-modal-pane-right" aria-labelledby="wd-editor-heading">
                {/* Timer banner — only shown for IELTS-mode assignments */}
                <div id="modal-timer" className="wd-modal-timer hidden">
                  <div>
                    <div className="wd-modal-timer__label">Bài viết có giới hạn thời gian</div>
                    <div className="wd-modal-timer__total" id="modal-timer-total">Tổng thời gian: — phút</div>
                  </div>
                  <div id="modal-timer-display" className="wd-modal-timer__display">--:--</div>
                </div>

                <div className="wd-editor-toolbar">
                  <div>
                    <span className="wd-modal-section-label">Bài làm</span>
                    <h2 id="wd-editor-heading">Bài viết của em</h2>
                  </div>
                </div>

                {/* Essay textarea — Grammarly + autocorrect + spellcheck disabled */}
                <textarea id="modal-essay-textarea"
                          className="wd-modal-textarea"
                          rows={20}
                          placeholder="Bắt đầu bài viết của em tại đây…"
                          aria-describedby="modal-word-target"
                          autoComplete="off"
                          autoCorrect="off"
                          autoCapitalize="off"
                          spellCheck="false"
                          data-gramm="false"
                          data-gramm_editor="false"
                          data-enable-grammarly="false"></textarea>

                <div className="wd-word-progress">
                  <div className="wd-word-progress__copy">
                    <strong><span id="modal-word-counter">0</span> từ</strong>
                    <span id="modal-word-target">Mục tiêu tối thiểu — từ</span>
                  </div>
                  <div className="wd-word-progress__track" aria-hidden="true">
                    <span id="modal-word-progress"></span>
                  </div>
                </div>

                {/* Footer */}
                <footer className="wd-modal-footer">
                  <div className="wd-modal-footer-meta">
                    <span id="modal-save-status" className="wd-modal-save-status hidden">Đã lưu bản nháp</span>
                    <span id="modal-save-pending" className="wd-modal-save-pending hidden">Đang lưu…</span>
                    <span className="wd-modal-autosave-hint">Bản nháp tự lưu khi em viết</span>
                  </div>
                  <div className="wd-modal-actions">
                    <button id="modal-btn-save" type="button"
                            className="wd-modal-btn-save">
                      Lưu bản nháp
                    </button>
                    <button id="modal-btn-submit" type="button"
                            className="wd-modal-btn-submit">
                      Kiểm tra và nộp bài
                    </button>
                  </div>
                </footer>
              </section>

            </div>
          </div>
        </div>

        {/* W-SOFTCHECK — pre-submit spell-check panel (soft, opt-in). Suspect
             words + suggestions; student fixes or submits anyway. */}
        <div id="spell-panel" className="wd-spell-panel hidden" role="dialog" aria-modal="true" aria-labelledby="spell-panel-title">
          <div className="wd-spell-panel__box">
            <h3 id="spell-panel-title" className="wd-spell-panel__title">Kiểm tra chính tả</h3>
            <p className="wd-spell-panel__hint">
              Có <strong><span id="spell-count">0</span> từ</strong> có thể sai chính tả.
              Em có thể quay lại sửa, hoặc nộp luôn.
            </p>
            <ul id="spell-list" className="wd-spell-panel__list"></ul>
            <div className="wd-spell-panel__actions">
              <button id="spell-btn-back" type="button" className="wd-spell-btn-back text-sm rounded px-4 py-2">← Quay lại sửa</button>
              <button id="spell-btn-submit" type="button" className="wd-spell-btn-submit text-sm font-medium rounded px-4 py-2">Nộp luôn</button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
