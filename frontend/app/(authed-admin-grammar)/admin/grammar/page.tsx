import type { Metadata } from 'next';

import { AdminAccessGate } from '@/components/admin-access-gate';

export const metadata: Metadata = {
  title: 'Grammar workspace · Admin',
  description: 'Điều phối nội dung, analytics và recommendation của Grammar Wiki.',
  robots: { index: false, follow: false },
};

const destinations = [
  {
    number: '01',
    eyebrow: 'Kho nội dung',
    title: 'Articles browser',
    description: 'Tra cứu toàn bộ bài viết, lọc theo danh mục và xem trước bản Markdown đã render.',
    detail: 'Tìm kiếm · Danh mục · Preview',
    href: '/admin/grammar/articles',
    status: 'READ-ONLY',
    statusClass: 'is-readonly',
    featured: true,
  },
  {
    number: '02',
    eyebrow: 'Tín hiệu người học',
    title: 'Analytics',
    description: 'Theo dõi lượt xem, lượt lưu, nội dung nổi bật và những bài chưa có tương tác.',
    detail: 'Views · Saves · Content gaps',
    href: '/admin/grammar/analytics',
    status: 'LIVE',
    statusClass: 'is-live',
    featured: false,
  },
  {
    number: '03',
    eyebrow: 'Kiểm định matcher',
    title: 'Recommendation tester',
    description: 'Thử lỗi ngữ pháp mẫu và kiểm tra bài viết, anchor cùng điểm khớp trước khi phát hành.',
    detail: 'Article · Anchor · Match score',
    href: '/pages/admin/grammar/recommend-test.html',
    status: 'LIVE',
    statusClass: 'is-live',
    featured: false,
  },
  {
    number: '04',
    eyebrow: 'Ngân hàng luyện tập',
    title: 'Grammar exercises',
    description: 'Mở console dùng chung để quản lý chủ đề, ngân hàng câu hỏi và bài luyện Grammar.',
    detail: 'Topics · Banks · Questions',
    href: '/pages/admin/vocab/topics.html?skill_area=grammar',
    status: 'SHARED CONSOLE',
    statusClass: 'is-new',
    featured: false,
  },
] as const;

export default function AdminGrammarPage() {
  return (
    <aver-admin-chrome active="grammar">
      <AdminAccessGate>
        <main className="grh-shell">
          <header className="grh-hero">
            <div className="grh-hero__copy">
              <p className="grh-eyebrow">Nội dung học tập</p>
              <h1>Grammar workspace</h1>
              <p className="grh-subtitle">
                Một điểm vào để kiểm tra kho bài viết, tín hiệu sử dụng và chất lượng gợi ý
                trước khi nội dung đến với học viên.
              </p>
            </div>
            <a className="grh-preview-link" href="/grammar">
              <span className="grh-preview-link__label">Xem phía học viên</span>
              <span aria-hidden="true">↗</span>
            </a>
          </header>

          <section className="grh-publishing" aria-labelledby="grammar-publishing-title">
            <div className="grh-publishing__intro">
              <span className="adm-status-pill is-readonly">FILE-BASED</span>
              <div>
                <h2 id="grammar-publishing-title">Nguồn xuất bản nằm trong repository</h2>
                <p>
                  Admin này không sửa trực tiếp bài viết. Nội dung chuẩn nằm tại{' '}
                  <code>backend/content/&lt;category&gt;/&lt;slug&gt;.md</code>.
                </p>
              </div>
            </div>
            <ol className="grh-publishing__steps" aria-label="Quy trình xuất bản Grammar">
              <li><span>1</span><strong>Sửa Markdown</strong><small>trong repository</small></li>
              <li><span>2</span><strong>Review &amp; commit</strong><small>kiểm metadata và liên kết</small></li>
              <li><span>3</span><strong>Auto-deploy</strong><small>phát hành qua Vercel</small></li>
            </ol>
          </section>

          <section className="grh-workspaces" aria-labelledby="grammar-workspaces-title">
            <div className="grh-section-heading">
              <div>
                <p className="grh-eyebrow">Công cụ vận hành</p>
                <h2 id="grammar-workspaces-title">Bạn muốn kiểm tra gì?</h2>
              </div>
              <p>Chọn đúng workspace để giữ luồng làm việc gọn và có chủ đích.</p>
            </div>

            <div className="grh-grid">
              {destinations.map((item) => (
                <a
                  className={`grh-card${item.featured ? ' grh-card--featured' : ''}`}
                  href={item.href}
                  key={item.number}
                >
                  <div className="grh-card__topline">
                    <span className="grh-card__number" aria-hidden="true">{item.number}</span>
                    <span className={`adm-status-pill ${item.statusClass}`}>{item.status}</span>
                  </div>
                  <div className="grh-card__body">
                    <p className="grh-card__eyebrow">{item.eyebrow}</p>
                    <h3>{item.title}</h3>
                    <p>{item.description}</p>
                  </div>
                  <div className="grh-card__footer">
                    <span>{item.detail}</span>
                    <span className="grh-card__arrow" aria-hidden="true">→</span>
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
