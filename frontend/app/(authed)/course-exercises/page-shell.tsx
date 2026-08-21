// CourseExerciseShell — khung tĩnh của trang làm bài tập theo buổi.
//
// Server Component: chỉ dựng khung có sẵn id để CourseBehavior vẽ vào. Không có
// dữ liệu nào được nạp ở phía máy chủ — token không đi qua ranh giới RSC
// (ADR-003 §3), nên toàn bộ nội dung riêng tư tới bằng `window.api` phía client,
// đúng như trang legacy.
//
// `course-exercises.css` khai ở ĐÂY chứ không ở layout (authed): layout ấy ghi
// rõ nó khớp từng byte với pages/profile.html, và nhét thêm một tệp CSS của
// trang khác vào đó là phá chính hợp đồng nó tự đặt. React 19 tự đưa
// <link rel="stylesheet"> lên <head>.
export function CourseShell() {
  return (
    <>
      <link rel="stylesheet" href="/css/course-exercises.css" />
      {/* Báo cáo sau khi làm bài dùng CHUNG bộ vẽ với mặt đọc của giáo viên,
          nên cũng dùng chung tệp kiểu của nó. Không nạp tệp này thì báo cáo ra
          màn hình trần trụi — bài học PR #925. */}
      <link rel="stylesheet" href="/css/course-report.css" />

      <aver-chrome active="class"></aver-chrome>

      <main className="cx-wrap">
        <a className="cx-back" href="/my-class">← Quay lại My Class</a>

        <header className="cx-page-head">
          <div>
            <p className="cx-eyebrow">Grammar practice</p>
            <h1 id="cx-title">Bài tập theo buổi</h1>
            <p id="cx-title-meta">Làm từng câu, xem đáp án và giải thích ngay sau khi chọn.</p>
          </div>
          <div
            className="cx-save-note"
            id="cx-save-note"
            data-state="idle"
            role="status"
            aria-live="polite"
            aria-label="Trạng thái lưu bài"
          >
            <span className="cx-save-note__dot" aria-hidden="true"></span>
            <span id="cx-save-note-text">Sẽ lưu khi hoàn thành chặng</span>
          </div>
        </header>

        {/* Thanh chặng: dính đầu, luôn trong tầm mắt. Mỗi vạch là MỘT câu của
            chặng — một thanh trượt liền chỉ nói được "bao nhiêu phần trăm". */}
        <div className="cx-stage" id="cx-stage" hidden>
          <span className="cx-stage__label" id="cx-stage-label"></span>
          <span className="cx-stage__ticks" id="cx-stage-ticks" aria-hidden="true"></span>
        </div>

        <div id="cx-loading" className="cx-empty">Đang mở bài tập…</div>
        <div id="cx-error" className="cx-empty" hidden></div>

        {/* Một câu, dựng lại mỗi lần chuyển. */}
        <section id="cx-q" className="cx-q" hidden></section>

        <div className="cx-next" id="cx-next" hidden></div>

        {/* Hết chặng */}
        <section id="cx-done" className="cx-done" hidden></section>

        {/* Bài đọc thêm là một nhịp học riêng: passage + từ vựng + 10 câu tự
            đối chiếu. Giữ khung riêng để màn session không phải gánh bố cục
            đọc dài và để bài đọc có thể rộng hơn thẻ quiz. */}
        <section id="cx-reading" className="cx-reading" hidden></section>

        {/* Bài nghe dùng khung riêng để audio và lựa chọn không chen vào flow
            mastery. Đáp án/transcript được tải riêng sau khi làm đủ 20 câu. */}
        <section id="cx-listening" className="cx-listening" hidden></section>

        {/* Shadowing là một lượt riêng: thu từng câu, nộp cả bộ và đọc kết quả
            Azure. Không chen MediaRecorder vào vòng mastery của trắc nghiệm. */}
        <section id="cx-pronunciation" className="cx-pronunciation" hidden></section>

        {/* Báo cáo: yếu trục nào, sai câu nào, chọn nhầm gì. Một khối RIÊNG chứ
            không nhét vào `cx-done` — màn kết chặng bị vẽ lại sau mỗi chặng, và
            báo cáo thì phải ở lại khi học viên đang đọc nó. */}
        <section id="cx-report" className="cx-report" hidden></section>
      </main>
    </>
  );
}
