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
            <p className="eyebrow"><a href="/listening" style={{ color: "var(--av-text-secondary)" }}>← Quay lại Listening</a></p>
            <h1>Luyện <span className="accent">kĩ năng</span></h1>
            <p className="subtitle">
              Chọn dạng câu hỏi bạn muốn luyện riêng (điền form, bản đồ, nối, trắc nghiệm…).
              Mỗi bài là 1 section ngắn — cùng giao diện làm bài &amp; chữa bài (nghe lại đúng
              đoạn audio) như Mini Test, chấm điểm sau khi nộp.
            </p>
          </header>

          <div className="empty-state" id="state-loading">Đang tải danh sách bài luyện…</div>
          <div className="empty-state" id="state-empty" hidden>
            <p><strong>Chưa có bài luyện nào sẵn sàng.</strong></p>
            <p>Hãy quay lại sau khi admin xuất bản skill drill mới.</p>
          </div>
          <div className="error-banner" id="state-error" hidden></div>

          <section id="ls-groups" hidden></section>
        </main>
      </div>
    </>
  );
}
