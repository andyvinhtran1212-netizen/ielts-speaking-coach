import type { Metadata } from 'next';

import { AdminAccessGate } from '@/components/admin-access-gate';

export const metadata: Metadata = {
  title: 'Reading operations · Admin',
  description: 'Điều phối nội dung, lượt làm bài và phản hồi của Reading.',
  robots: { index: false, follow: false },
};

const workspaces = [
  {
    number: '01',
    eyebrow: 'Content library',
    title: 'Passages & answer keys',
    description: 'Soạn passage, cấu trúc câu hỏi và đáp án trước khi nội dung được phát hành đến thư viện Reading.',
    detail: 'Passages · Questions · Publish',
    href: '/admin/reading/content',
    status: 'NATIVE',
    statusClass: 'is-live',
    featured: true,
  },
  {
    number: '02',
    eyebrow: 'Learning evidence',
    title: 'Attempt analytics',
    description: 'Đối chiếu lượt nộp, band, hiệu suất từng kỹ năng và thời gian làm bài trên dữ liệu đã lưu.',
    detail: 'Attempts · Band · Skill breakdown',
    href: '/admin/dashboard/reading-attempts',
    status: 'NATIVE',
    statusClass: 'is-live',
    featured: false,
  },
  {
    number: '03',
    eyebrow: 'Learner signals',
    title: 'Reading feedback',
    description: 'Lọc báo lỗi và đánh giá từ người học để xác minh nội dung trước khi chỉnh passage hoặc answer key.',
    detail: 'Reports · Ratings · Resolution',
    href: '/admin/feedback?skill=reading',
    status: 'NATIVE',
    statusClass: 'is-live',
    featured: false,
  },
] as const;

export default function AdminReadingPage() {
  return (
    <aver-admin-chrome active="reading">
      <AdminAccessGate>
        <main className="rdh-shell">
          <header className="rdh-hero">
            <div className="rdh-hero__copy">
              <p className="rdh-eyebrow">Reading · Operations</p>
              <h1>Reading workspace</h1>
              <p className="rdh-subtitle">
                Một điểm vào để chuẩn bị nội dung, kiểm chứng kết quả và xử lý tín hiệu
                từ học viên trước khi thay đổi bài Reading.
              </p>
            </div>
            <a className="rdh-preview-link" href="/reading/test">
              <span>Xem phía học viên</span><span aria-hidden="true">↗</span>
            </a>
          </header>

          <section className="rdh-flow" aria-labelledby="reading-flow-title">
            <div className="rdh-flow__intro">
              <span className="adm-status-pill is-live">QUALITY LOOP</span>
              <div>
                <h2 id="reading-flow-title">Từ nội dung đến bằng chứng</h2>
                <p>Đi theo đúng luồng để mỗi chỉnh sửa đều bắt đầu từ passage thật và dữ liệu thật.</p>
              </div>
            </div>
            <ol className="rdh-flow__steps" aria-label="Quy trình vận hành Reading">
              <li><span>1</span><strong>Chuẩn bị nội dung</strong><small>passage, câu hỏi và đáp án</small></li>
              <li><span>2</span><strong>Đọc kết quả</strong><small>attempt, band và kỹ năng</small></li>
              <li><span>3</span><strong>Xử lý phản hồi</strong><small>xác minh rồi mới chỉnh sửa</small></li>
            </ol>
          </section>

          <section className="rdh-workspaces" aria-labelledby="reading-workspaces-title">
            <div className="rdh-section-heading">
              <div>
                <p className="rdh-eyebrow">Công cụ vận hành</p>
                <h2 id="reading-workspaces-title">Bạn cần xử lý phần nào?</h2>
              </div>
              <p>Content, Analytics và Feedback đều chạy native; trang HTML cũ chỉ còn là mốc rollback trực tiếp.</p>
            </div>
            <div className="rdh-grid">
              {workspaces.map((item) => (
                <a className={`rdh-card${item.featured ? ' rdh-card--featured' : ''}`} href={item.href} key={item.number}>
                  <div className="rdh-card__topline">
                    <span className="rdh-card__number" aria-hidden="true">{item.number}</span>
                    <span className={`adm-status-pill ${item.statusClass}`}>{item.status}</span>
                  </div>
                  <div className="rdh-card__body">
                    <p className="rdh-card__eyebrow">{item.eyebrow}</p>
                    <h3>{item.title}</h3>
                    <p>{item.description}</p>
                  </div>
                  <div className="rdh-card__footer">
                    <span>{item.detail}</span><span className="rdh-card__arrow" aria-hidden="true">→</span>
                  </div>
                </a>
              ))}
            </div>
          </section>
        </main>
      </AdminAccessGate>
    </aver-admin-chrome>
  );
}
