import { VocabExamBehavior } from './vocab-exam-behavior';

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

      <VocabExamBehavior />
    </div>
  );
}
