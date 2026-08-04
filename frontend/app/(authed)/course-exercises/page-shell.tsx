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

      <aver-chrome active="courses"></aver-chrome>

      {/* Thanh chặng: dính đầu, luôn trong tầm mắt. Mỗi vạch là MỘT câu của
          chặng — một thanh trượt liền chỉ nói được "bao nhiêu phần trăm". */}
      <div className="cx-stage" id="cx-stage" hidden>
        <span className="cx-stage__label" id="cx-stage-label"></span>
        <span className="cx-stage__ticks" id="cx-stage-ticks" aria-hidden="true"></span>
      </div>

      <main className="cx-wrap">
        <div id="cx-loading" className="cx-empty">Đang mở bài tập…</div>
        <div id="cx-error" className="cx-empty" hidden></div>

        {/* Một câu, dựng lại mỗi lần chuyển. */}
        <section id="cx-q" hidden aria-live="polite"></section>

        <div className="cx-next" id="cx-next" hidden></div>

        {/* Hết chặng */}
        <section id="cx-done" className="cx-done" hidden></section>
      </main>
    </>
  );
}
