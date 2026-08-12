import type { Metadata } from 'next';

import { AdminAccessGate } from '@/components/admin-access-gate';

export const metadata: Metadata = {
  title: 'Speaking operations · Admin',
  description: 'Điều phối kiểm định session, thư viện topic và sức khỏe hệ thống Speaking.',
  robots: { index: false, follow: false },
};

const workspaces = [
  {
    number: '01',
    eyebrow: 'Quality assurance',
    title: 'Sessions & grading',
    description: 'Tìm buổi luyện theo học viên, mode, trạng thái hoặc lỗi; nghe lại từng câu và kiểm tra feedback đã phát.',
    detail: 'Audio · Transcript · Regrade · Summary',
    href: '/pages/admin/speaking/sessions.html',
    status: 'LEGACY WORKSPACE',
    statusClass: 'is-readonly',
    featured: true,
  },
  {
    number: '02',
    eyebrow: 'Content library',
    title: 'Topics & questions',
    description: 'Quản lý topic Part 1–3, câu hỏi, cue card và luồng sinh câu hỏi trước khi nội dung đến người học.',
    detail: 'Part 1–3 · Questions · Cue cards',
    href: '/pages/admin/speaking/topics.html',
    status: 'LEGACY WORKSPACE',
    statusClass: 'is-readonly',
    featured: false,
  },
  {
    number: '03',
    eyebrow: 'Operational health',
    title: 'AI usage & alerts',
    description: 'Theo dõi chi phí AI và mở hàng cảnh báo grading để điều tra sự cố xuyên suốt pipeline Speaking.',
    detail: 'Tokens · Cost · Grading failures',
    href: '/admin/system',
    status: 'NATIVE',
    statusClass: 'is-live',
    featured: false,
  },
] as const;

export default function AdminSpeakingPage() {
  return (
    <aver-admin-chrome active="speaking">
      <AdminAccessGate>
        <main className="sph-shell">
          <header className="sph-hero">
            <div className="sph-hero__copy">
              <p className="sph-eyebrow">Speaking · Operations</p>
              <h1>Speaking workspace</h1>
              <p className="sph-subtitle">
                Một điểm vào để kiểm định bài nói, quản lý nguồn câu hỏi và theo dõi
                sức khỏe pipeline trước khi feedback đến học viên.
              </p>
            </div>
            <a className="sph-preview-link" href="/speaking">
              <span>Xem phía học viên</span><span aria-hidden="true">↗</span>
            </a>
          </header>

          <section className="sph-flow" aria-labelledby="speaking-flow-title">
            <div className="sph-flow__intro">
              <span className="adm-status-pill is-live">OPERATIONS</span>
              <div>
                <h2 id="speaking-flow-title">Từ tín hiệu đến hành động</h2>
                <p>Đi theo đúng luồng để phân biệt lỗi bài làm, lỗi nội dung và lỗi hệ thống.</p>
              </div>
            </div>
            <ol className="sph-flow__steps" aria-label="Quy trình vận hành Speaking">
              <li><span>1</span><strong>Kiểm session</strong><small>nghe audio và đọc feedback</small></li>
              <li><span>2</span><strong>Đối chiếu nội dung</strong><small>topic, question và cue card</small></li>
              <li><span>3</span><strong>Điều tra pipeline</strong><small>AI usage và grading alerts</small></li>
            </ol>
          </section>

          <section className="sph-workspaces" aria-labelledby="speaking-workspaces-title">
            <div className="sph-section-heading">
              <div>
                <p className="sph-eyebrow">Công cụ vận hành</p>
                <h2 id="speaking-workspaces-title">Bạn cần xử lý phần nào?</h2>
              </div>
              <p>Hai workspace nghiệp vụ vẫn giữ rollback HTML cho tới khi được migrate ở PR riêng.</p>
            </div>
            <div className="sph-grid">
              {workspaces.map((item) => (
                <a className={`sph-card${item.featured ? ' sph-card--featured' : ''}`} href={item.href} key={item.number}>
                  <div className="sph-card__topline">
                    <span className="sph-card__number" aria-hidden="true">{item.number}</span>
                    <span className={`adm-status-pill ${item.statusClass}`}>{item.status}</span>
                  </div>
                  <div className="sph-card__body">
                    <p className="sph-card__eyebrow">{item.eyebrow}</p>
                    <h3>{item.title}</h3>
                    <p>{item.description}</p>
                  </div>
                  <div className="sph-card__footer">
                    <span>{item.detail}</span><span className="sph-card__arrow" aria-hidden="true">→</span>
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
