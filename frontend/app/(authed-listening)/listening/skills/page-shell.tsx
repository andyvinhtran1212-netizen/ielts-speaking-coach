// Vỏ tĩnh của trang Listening Skills Practice — chép TRUNG THỰC từ `public/pages/listening-skills.html`.
//
// VÌ SAO CHÉP CƠ HỌC THAY VÌ "VIẾT LẠI CHO ĐẸP": bài học pilot 2 (#741) —
// dựng lại từ đầu làm gãy cascade CSS và chỉ phát hiện được nhờ so ảnh chụp.
// Ở đây ràng buộc còn mạnh hơn: hành vi KHÔNG được port, `page.tsx` nạp thẳng
// module legacy `/js/listening-skills.js` — CHÍNH tệp trang legacy dùng — và module đó
// tìm phần tử theo **id**. Trang này có 4 id (ls-groups, state-empty, state-error, state-loading);
// đổi tên bất kỳ chỗ nào là hỏng CẢ HAI bản cùng lúc.
//
// `<aver-chrome>` do `page.tsx` dựng, KHÔNG dựng ở đây — bản port trang Bài
// viết từng chép cả thẻ đó từ legacy và ra hai thanh điều hướng (#950).

export function ListeningSkillsShell() {
  return (
    <>
      <div className="shell">
        <main className="ls-shell">
          <header className="ls-header">
            <a className="ls-back" href="/listening">← Quay lại Listening</a>
            <p className="eyebrow">LUYỆN THEO DẠNG CÂU HỎI</p>
            <h1>Chọn đúng kĩ năng, <span className="accent">luyện sâu hơn</span></h1>
            <p className="subtitle">
              Tập riêng từng dạng câu hỏi IELTS Listening, nhận điểm ngay sau khi nộp
              và nghe lại đúng đoạn audio để hiểu mình đã bỏ lỡ chi tiết nào.
            </p>
            <div className="ls-summary" id="ls-summary" hidden aria-live="polite">
              <div className="ls-summary__item">
                <span className="ls-summary__value" id="ls-total-count">0</span>
                <span className="ls-summary__label">Bài đang mở</span>
              </div>
              <div className="ls-summary__item">
                <span className="ls-summary__value" id="ls-done-count">0</span>
                <span className="ls-summary__label">Đã luyện</span>
              </div>
              <div className="ls-summary__item">
                <span className="ls-summary__value" id="ls-type-count">0</span>
                <span className="ls-summary__label">Dạng kĩ năng</span>
              </div>
            </div>
          </header>

          <div className="empty-state" id="state-loading">Đang tải danh sách bài luyện…</div>
          <div className="empty-state" id="state-empty" hidden>
            <p><strong>Chưa có bài luyện nào sẵn sàng.</strong></p>
            <p>Hãy quay lại sau khi admin xuất bản skill drill mới.</p>
          </div>
          <div className="error-banner" id="state-error" hidden></div>

          <section className="ls-library" id="ls-library" hidden aria-labelledby="ls-library-title">
            <div className="ls-toolbar">
              <div>
                <p className="eyebrow">LỘ TRÌNH KĨ NĂNG</p>
                <h2 id="ls-library-title">Chọn dạng bài cần luyện</h2>
                <p>Mỗi lần chỉ tập trung vào một dạng để danh sách ngắn và dễ theo dõi.</p>
              </div>
            </div>
            <nav className="ls-skill-nav" id="ls-skill-nav" aria-label="Các dạng câu hỏi Listening"></nav>
            <div className="ls-library-head">
              <p className="ls-visible-count" id="ls-visible-count" aria-live="polite"></p>
              <div className="ls-filter" role="group" aria-label="Lọc bài luyện theo trạng thái">
                <button className="ls-filter__button is-active" type="button" data-status-filter="all" aria-pressed="true">Tất cả</button>
                <button className="ls-filter__button" type="button" data-status-filter="new" aria-pressed="false">Chưa làm</button>
                <button className="ls-filter__button" type="button" data-status-filter="done" aria-pressed="false">Đã luyện</button>
              </div>
            </div>
            <section id="ls-groups"></section>
          </section>
        </main>
      </div>
    </>
  );
}
