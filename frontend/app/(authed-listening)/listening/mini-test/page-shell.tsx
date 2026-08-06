// Vỏ tĩnh của trang Listening Mini Tests — chép TRUNG THỰC từ `public/pages/listening-mini-test.html`.
//
// VÌ SAO CHÉP CƠ HỌC THAY VÌ "VIẾT LẠI CHO ĐẸP": bài học pilot 2 (#741) —
// dựng lại từ đầu làm gãy cascade CSS và chỉ phát hiện được nhờ so ảnh chụp.
// Ở đây ràng buộc còn mạnh hơn: hành vi KHÔNG được port, `page.tsx` nạp thẳng
// module legacy `/js/listening-mini-test.js` — CHÍNH tệp trang legacy dùng — và module đó
// tìm phần tử theo **id**. Trang này có 4 id (lt-grid, state-empty, state-error, state-loading);
// đổi tên bất kỳ chỗ nào là hỏng CẢ HAI bản cùng lúc.
//
// `<aver-chrome>` do `page.tsx` dựng, KHÔNG dựng ở đây — bản port trang Bài
// viết từng chép cả thẻ đó từ legacy và ra hai thanh điều hướng (#950).

export function ListeningMiniTestShell() {
  return (
    <>
      <div className="shell">
        <main className="lt-shell">
          <header className="lt-header">
            <p className="eyebrow"><a href="/pages/listening.html" style={{ color: "var(--av-text-secondary)" }}>← Quay lại Listening</a></p>
            <h1>Listening <span className="accent">Mini Tests</span></h1>
            <p className="subtitle">
              Bài thi ngắn — 1 section, số câu tùy bài, sát đề thật. Cùng giao diện
              làm bài &amp; chữa bài (kèm nghe lại đúng đoạn audio) như Full Test,
              chấm điểm + band ước tính sau khi nộp.
            </p>
          </header>

          <div className="empty-state" id="state-loading">Đang tải danh sách mini tests…</div>
          <div className="empty-state" id="state-empty" hidden>
            <p><strong>Chưa có mini test nào sẵn sàng.</strong></p>
            <p>Hãy quay lại sau khi admin xuất bản mini test mới.</p>
          </div>
          <div className="error-banner" id="state-error" hidden></div>

          <section id="lt-grid" className="lt-grid" hidden></section>
        </main>
      </div>
    </>
  );
}
