// Vỏ tĩnh của trang Listening Mini Tests — chép TRUNG THỰC từ `public/pages/listening-mini-test.html`.
//
// VÌ SAO CHÉP CƠ HỌC THAY VÌ "VIẾT LẠI CHO ĐẸP": bài học pilot 2 (#741) —
// dựng lại từ đầu làm gãy cascade CSS và chỉ phát hiện được nhờ so ảnh chụp.
// Ở đây ràng buộc còn mạnh hơn: hành vi KHÔNG được port, `page.tsx` nạp thẳng
// module legacy `/js/listening-mini-test.js` — CHÍNH tệp trang legacy dùng — và module đó
// tìm phần tử theo **id**. Grid, states, summary và filter đều là contract DOM;
// đổi tên một phía mà không đổi controller là hỏng CẢ HAI bản cùng lúc.
//
// `<aver-chrome>` do `page.tsx` dựng, KHÔNG dựng ở đây — bản port trang Bài
// viết từng chép cả thẻ đó từ legacy và ra hai thanh điều hướng (#950).

export function ListeningMiniTestShell() {
  return (
    <>
      <div className="shell">
        <main className="lt-shell">
          <header className="lt-header">
            <a className="lt-back" href="/listening">← Quay lại Listening</a>
            <p className="eyebrow">LUYỆN NGHE THEO CHẶNG NGẮN</p>
            <h1>Mini test, <span className="accent">một section mỗi lượt</span></h1>
            <p className="subtitle">
              Tập trung trọn vẹn vào một section, nhận điểm ngay sau khi nộp rồi
              quay lại đúng đoạn audio để hiểu vì sao mình nghe sai.
            </p>
            <div className="lt-summary" id="lt-summary" hidden aria-live="polite">
              <div className="lt-summary__item">
                <span className="lt-summary__value" id="lt-total-count">0</span>
                <span className="lt-summary__label">Bài đang mở</span>
              </div>
              <div className="lt-summary__item">
                <span className="lt-summary__value" id="lt-new-count">0</span>
                <span className="lt-summary__label">Chưa làm</span>
              </div>
              <div className="lt-summary__item">
                <span className="lt-summary__value" id="lt-done-count">0</span>
                <span className="lt-summary__label">Đã luyện</span>
              </div>
            </div>
          </header>

          <div className="empty-state" id="state-loading">Đang tải danh sách mini tests…</div>
          <div className="empty-state" id="state-empty" hidden>
            <p><strong>Chưa có mini test nào sẵn sàng.</strong></p>
            <p>Hãy quay lại sau khi admin xuất bản mini test mới.</p>
          </div>
          <div className="error-banner" id="state-error" hidden></div>

          <section className="lt-library" id="lt-library" hidden aria-labelledby="lt-library-title">
            <div className="lt-toolbar">
              <div>
                <p className="eyebrow">THƯ VIỆN MINI TEST</p>
                <h2 id="lt-library-title">Chọn bài để bắt đầu</h2>
              </div>
              <div className="lt-filter" role="group" aria-label="Lọc mini test">
                <button className="lt-filter__button is-active" type="button" data-filter="all" aria-pressed="true">Tất cả</button>
                <button className="lt-filter__button" type="button" data-filter="new" aria-pressed="false">Chưa làm</button>
                <button className="lt-filter__button" type="button" data-filter="done" aria-pressed="false">Đã luyện</button>
              </div>
            </div>
            <p className="lt-visible-count" id="lt-visible-count" aria-live="polite"></p>
            <div id="lt-grid" className="lt-grid"></div>
          </section>
        </main>
      </div>
    </>
  );
}
