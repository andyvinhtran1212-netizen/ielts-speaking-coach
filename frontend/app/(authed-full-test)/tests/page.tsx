import type { Metadata } from 'next';

import { FullTestBehavior } from './full-test-behavior';

export const metadata: Metadata = {
  title: 'Thi thử Full Test 4 kỹ năng — Aver Learning',
  robots: { index: false, follow: false },
};

export default function FullTestPage() {
  return (
    <>
      {/* @ts-ignore — custom element do aver-chrome.js đăng ký. */}
      <aver-chrome active="mock" />
      <main className="shell ft-wrap">
        <header className="subpage-header">
          <div className="subpage-header__lhs">
            <a className="subpage-header__back" href="/home"><span aria-hidden="true">←</span><span>Trang chủ</span></a>
          </div>
        </header>
        <section className="ft-hero">
          <div>
            <p className="ft-eyebrow">Thi thử 4 kỹ năng</p>
            <h1>Không gian thi được điều phối như ngày thi thật</h1>
            <p>Hoàn thành Listening, Reading và Writing theo thứ tự giám thị mở; Speaking được tổ chức riêng. Mỗi lúc bạn chỉ có một lượt thi đang hoạt động.</p>
          </div>
          <div className="ft-hero__note"><span>Kết quả</span><strong>Giám khảo duyệt trước khi trả</strong></div>
        </section>
        <FullTestBehavior />
      </main>
    </>
  );
}
