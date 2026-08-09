import type { Metadata } from 'next';

import { VocabPracticeBehavior } from './vocab-practice-behavior';

export const metadata: Metadata = {
  title: 'Luyện tập từ vựng',
  robots: { index: false, follow: false },
};

export default function VocabPracticePage() {
  return (
    <>
      {/* @ts-ignore — custom element do aver-chrome.js đăng ký. */}
      <aver-chrome active="vocabulary" />
      <div className="shell">
        <header className="subpage-header">
          <div className="subpage-header__lhs">
            <a className="subpage-header__back" href="/vocabulary/hub">
              <span aria-hidden="true">←</span><span>Vocabulary</span>
            </a>
            <span className="subpage-header__sep">|</span>
            <h1 className="subpage-header__title">Luyện tập từ vựng</h1>
          </div>
        </header>

        <h2 className="vp-hub-title">Chọn một bài để bắt đầu</h2>
        <p className="vp-hub-sub">
          Mỗi bài <strong>kiểm tra tới khi bạn thuộc trọn vẹn cả list từ</strong> —
          có câu gõ tự luận, chống đoán mò và ôn lại từ hay sai. Tiến độ được lưu để bạn học tiếp ở lần sau.
        </p>

        <VocabPracticeBehavior />
      </div>
    </>
  );
}
