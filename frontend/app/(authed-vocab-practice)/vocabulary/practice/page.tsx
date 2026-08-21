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
      <main className="shell vp-shell">
        <header className="subpage-header">
          <div className="subpage-header__lhs">
            <a className="subpage-header__back" href="/vocabulary/hub">
              <span aria-hidden="true">←</span><span>Vocabulary</span>
            </a>
          </div>
        </header>

        <section className="vp-hero" aria-labelledby="vp-title">
          <div>
            <p className="vp-eyebrow">Luyện tập chủ động</p>
            <h1 id="vp-title">Biến từ mới thành vốn từ của bạn</h1>
            <p>
              Luyện theo từng bộ tới khi thuộc trọn vẹn cả list từ, sửa ngay
              những từ còn nhầm và tiếp tục đúng nơi bạn đã dừng. Tiến độ được
              lưu tự động sau mỗi phiên.
            </p>
          </div>
          <a className="vp-hero__link" href="/quiz/progress?skill_area=vocab">
            Xem toàn bộ tiến độ <span aria-hidden="true">→</span>
          </a>
        </section>

        <VocabPracticeBehavior />
      </main>
    </>
  );
}
