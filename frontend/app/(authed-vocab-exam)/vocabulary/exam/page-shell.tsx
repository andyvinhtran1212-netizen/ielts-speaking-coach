// Vỏ tĩnh của trang Từ vựng luyện thi — chép TRUNG THỰC từ
// `public/pages/vocab-exam.html`.
//
// Hành vi KHÔNG được port: `page.tsx` nạp thẳng `/js/vocab-exam.js` — CHÍNH tệp
// trang legacy dùng — và tệp đó tìm phần tử theo **id**. Trang này có 4 id
// (vx-empty, vx-error, vx-list, vx-loading); đổi tên bất kỳ chỗ nào là hỏng CẢ
// HAI bản cùng lúc.
//
// `<aver-chrome>` do `page.tsx` dựng, KHÔNG dựng ở đây (bài học #950: chép cả
// thẻ đó từ legacy ra hai thanh điều hướng).
export function VocabExamShell() {
  return (
    <div className="shell">
      <header className="subpage-header">
        <div className="subpage-header__lhs">
          <a className="subpage-header__back" href="/vocabulary/hub">
            <span aria-hidden="true">←</span><span>Vocabulary</span>
          </a>
          <span className="subpage-header__sep">|</span>
          <h1 className="subpage-header__title">Từ vựng luyện thi</h1>
        </div>
      </header>

      <h2 className="vx-hub-title">Chọn danh sách để học</h2>
      <p className="vx-hub-sub">
        Từ vựng theo <strong>danh sách đề thi</strong> — AWL (Academic Word List) cho IELTS,
        TOEIC Core, và THPT Core. Tách riêng khỏi từ vựng theo chủ đề của bạn; học bằng flashcards.
      </p>

      <p id="vx-loading" className="vx-status">Đang tải…</p>
      <div id="vx-list" className="hidden"></div>
      <p id="vx-empty" className="vx-status hidden">Chưa có danh sách luyện thi nào. Vui lòng quay lại sau.</p>
      <p id="vx-error" className="vx-status is-error hidden"></p>
    </div>
  );
}
