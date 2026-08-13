import type { Metadata } from 'next';

import { AdminAccessGate } from '@/components/admin-access-gate';

export const metadata: Metadata = {
  title: 'Writing operations · Admin',
  description: 'Điều phối nội dung, hàng chờ chấm và bài giao Writing.',
  robots: { index: false, follow: false },
};

const groups = [
  {
    step: '01',
    eyebrow: 'Soạn & chuẩn bị',
    title: 'Chuẩn hóa đầu vào',
    description: 'Tạo bài viết, quản lý prompt và biên tập mẹo trước khi nội dung đến học viên.',
    items: [
      { title: 'Soạn bài viết', detail: 'Tạo bài mới và chấm bằng AI', href: '/pages/admin/writing/new.html', status: 'MIGRATING', statusClass: 'is-soon' },
      { title: 'Thư viện prompt', detail: 'Task 1 · Task 2 · Sample essay', href: '/admin/writing/prompts', status: 'MIGRATING', statusClass: 'is-soon' },
      { title: 'Mẹo viết', detail: 'Nội dung hỗ trợ người học', href: '/admin/writing/tips', status: 'MIGRATING', statusClass: 'is-soon' },
    ],
  },
  {
    step: '02',
    eyebrow: 'Chấm & trả',
    title: 'Kiểm soát chất lượng',
    description: 'Đưa bài qua đúng lane, xử lý yêu cầu chấm lại và chỉ phát feedback đã được kiểm tra.',
    items: [
      { title: 'Hàng chờ chấm', detail: 'Duyệt · Chấm · Trả bài', href: '/pages/admin/writing/queue.html', status: 'MIGRATING', statusClass: 'is-soon' },
      { title: 'Yêu cầu chấm lại', detail: 'Quyết định theo trạng thái canonical', href: '/admin/writing/regrade-requests', status: 'MIGRATING', statusClass: 'is-soon' },
      { title: 'Hàng đợi Instructor', detail: 'Instructor tier cần review', href: '/pages/admin/writing/instructor-queue.html', status: 'MIGRATING', statusClass: 'is-soon' },
      { title: 'Workspace chấm bài', detail: '13 phần · Deliver · Regrade', href: '/admin/writing/grade', status: 'NATIVE', statusClass: 'is-live' },
    ],
  },
  {
    step: '03',
    eyebrow: 'Giao & theo dõi',
    title: 'Đóng vòng học tập',
    description: 'Giao đúng đề, theo dõi theo lớp và mở hồ sơ học viên từ cùng một luồng vận hành.',
    items: [
      { title: 'Gán bài tập', detail: 'Cá nhân · Lớp · Fan-out', href: '/admin/writing/assignments', status: 'MIGRATING', statusClass: 'is-soon' },
      { title: 'Lớp học', detail: 'Tiến độ chấm và trả theo lớp', href: '/admin/writing/cohorts', status: 'MIGRATING', statusClass: 'is-soon' },
      { title: 'Học viên', detail: 'Hồ sơ và lịch sử bài viết', href: '/admin/students', status: 'NATIVE', statusClass: 'is-live' },
    ],
  },
] as const;

export default function AdminWritingPage() {
  return (
    <aver-admin-chrome active="writing">
      <AdminAccessGate>
        <main className="wth-shell">
          <header className="wth-hero">
            <div className="wth-hero__copy">
              <p className="wth-eyebrow">Writing · Operations</p>
              <h1>Writing workspace</h1>
              <p className="wth-subtitle">
                Một điểm vào để chuẩn bị nội dung, kiểm soát chất lượng chấm và theo dõi
                bài giao — theo đúng thứ tự feedback đi từ hệ thống đến học viên.
              </p>
            </div>
            <a className="wth-preview-link" href="/writing/dashboard">
              <span>Xem phía học viên</span><span aria-hidden="true">↗</span>
            </a>
          </header>

          <section className="wth-principle" aria-labelledby="writing-principle-title">
            <span className="adm-status-pill is-live">CANONICAL FLOW</span>
            <div>
              <h2 id="writing-principle-title">Chuẩn bị → Chấm → Giao & theo dõi</h2>
              <p>Mỗi workspace giữ một trách nhiệm rõ ràng; trạng thái NATIVE/MIGRATING phản ánh đúng route đang sở hữu giao diện.</p>
            </div>
          </section>

          <div className="wth-groups">
            {groups.map((group) => (
              <section className="wth-group" aria-labelledby={`writing-group-${group.step}`} key={group.step}>
                <header className="wth-group__header">
                  <span className="wth-group__step" aria-hidden="true">{group.step}</span>
                  <div>
                    <p className="wth-eyebrow">{group.eyebrow}</p>
                    <h2 id={`writing-group-${group.step}`}>{group.title}</h2>
                    <p>{group.description}</p>
                  </div>
                </header>
                <div className="wth-grid">
                  {group.items.map((item) => (
                    <a className="wth-card" href={item.href} key={item.title}>
                      <div className="wth-card__topline">
                        <span className={`adm-status-pill ${item.statusClass}`}>{item.status}</span>
                        <span className="wth-card__arrow" aria-hidden="true">→</span>
                      </div>
                      <h3>{item.title}</h3>
                      <p>{item.detail}</p>
                    </a>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </main>
      </AdminAccessGate>
    </aver-admin-chrome>
  );
}
