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
      <div className="ft-wrap">
        <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--av-text-primary)', marginBottom: 4 }}>
          Thi thử Full Test 4 kỹ năng
        </h1>
        <p className="ft-muted" style={{ marginBottom: 20 }}>
          Listening → Reading → Writing, giám thị mở lần lượt từng phần và mỗi phần có đồng hồ riêng; Speaking vấn đáp riêng. Bài thu kín — giám khảo chấm và trả điểm sau. Mỗi lúc chỉ làm được một kỳ thi.
        </p>

        <FullTestBehavior />
      </div>
    </>
  );
}
