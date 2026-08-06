// Vỏ tĩnh của trang Listening Luyện nhanh — chép TRUNG THỰC từ `public/pages/listening-practice.html`.
//
// VÌ SAO CHÉP CƠ HỌC THAY VÌ "VIẾT LẠI CHO ĐẸP": bài học pilot 2 (#741) —
// dựng lại từ đầu làm gãy cascade CSS và chỉ phát hiện được nhờ so ảnh chụp.
// Ở đây ràng buộc còn mạnh hơn: hành vi KHÔNG được port, `page.tsx` nạp thẳng
// module legacy `/js/listening-practice.js` — CHÍNH tệp trang legacy dùng — và module đó
// tìm phần tử theo **id**. Trang này có 6 id (practice-body, practice-panel, practice-tabs, state-empty, state-error, state-loading);
// đổi tên bất kỳ chỗ nào là hỏng CẢ HAI bản cùng lúc.
//
// `<aver-chrome>` do `page.tsx` dựng, KHÔNG dựng ở đây — bản port trang Bài
// viết từng chép cả thẻ đó từ legacy và ra hai thanh điều hướng (#950).

export function ListeningPracticeShell() {
  return (
    <>
      <div className="shell">
        <main className="lp-shell">
          <header className="lp-header">
            <p className="eyebrow">
              <a href="/listening" style={{ color: "var(--av-text-secondary)" }}>← Quay lại Listening</a>
            </p>
            <h1>Luyện <span className="accent">nhanh</span></h1>
            <p className="subtitle">
              Bài ngắn 30–90 giây, thông tin dày. Không mô phỏng nhịp phòng thi —
              mục tiêu là bắt đúng chi tiết và nhận ra bẫy, làm được vài bài trong
              lúc chờ.
            </p>
          </header>

          <nav className="lp-tabs" id="practice-tabs" aria-label="Nhóm bài luyện"></nav>

          <div className="empty-state" id="state-loading">Đang tải…</div>
          <div className="empty-state" id="state-empty" hidden>
            <p><strong>Chưa có bài luyện nào.</strong></p>
            <p>Hãy quay lại sau khi quản trị viên đăng nội dung.</p>
          </div>
          <div className="error-banner" id="state-error" hidden></div>

          <div id="practice-body" hidden>
            <div id="practice-panel"></div>
          </div>
        </main>
      </div>
    </>
  );
}
