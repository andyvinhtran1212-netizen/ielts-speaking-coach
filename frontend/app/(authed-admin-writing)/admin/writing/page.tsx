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
      { title: 'Gửi bài chấm', detail: 'Nhập bài thay học viên · Đối chiếu kết quả gửi', href: '/admin/writing/new', status: 'Quản lý', statusClass: 'is-live' },
      { title: 'Thư viện prompt', detail: 'Đề bài · Hình Task 1 · Đáp án', href: '/admin/writing/prompts', status: 'Quản lý', statusClass: 'is-live' },
      { title: 'Mẹo viết', detail: 'Markdown · Phát hành · Đối chiếu sau import', href: '/admin/writing/tips', status: 'Quản lý', statusClass: 'is-live' },
    ],
  },
  {
    step: '02',
    eyebrow: 'Chấm & trả',
    title: 'Kiểm soát chất lượng',
    description: 'Đưa bài qua đúng lane, xử lý yêu cầu chấm lại và chỉ phát feedback đã được kiểm tra.',
    items: [
      { title: 'Hàng chờ chấm', detail: 'Duyệt · Chấm · Trả bài', href: '/admin/writing/queue', status: 'Quản lý', statusClass: 'is-live' },
      { title: 'Yêu cầu chấm lại', detail: 'Duyệt yêu cầu · Đối chiếu quyết định', href: '/admin/writing/regrade-requests', status: 'Quản lý', statusClass: 'is-live' },
      { title: 'Hàng đợi Instructor', detail: 'Nhận bài chấm · Đối chiếu người phụ trách', href: '/admin/writing/instructor-queue', status: 'Quản lý', statusClass: 'is-live' },
      { title: 'Workspace chấm bài', detail: 'Chọn bài từ hàng chờ · Mở workspace 13 phần', href: '/admin/writing/queue', status: 'Quản lý', statusClass: 'is-live' },
    ],
  },
  {
    step: '03',
    eyebrow: 'Giao & theo dõi',
    title: 'Đóng vòng học tập',
    description: 'Giao đúng đề, theo dõi theo lớp và mở hồ sơ học viên từ cùng một luồng vận hành.',
    items: [
      { title: 'Gán bài tập', detail: 'Giao bài cho lớp · Theo dõi kết quả từng lượt', href: '/admin/writing/assignments', status: 'Quản lý', statusClass: 'is-live' },
      { title: 'Lớp học', detail: 'Từng lượt giao · Trạng thái cập nhật · Lịch sử bài', href: '/admin/writing/cohorts', status: 'Quản lý', statusClass: 'is-live' },
      { title: 'Học viên', detail: 'Hồ sơ và lịch sử bài viết', href: '/admin/students', status: 'Quản lý', statusClass: 'is-live' },
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
            <span className="adm-status-pill is-live">LUỒNG VẬN HÀNH</span>
            <div>
              <h2 id="writing-principle-title">Chuẩn bị → Chấm → Giao & theo dõi</h2>
              <p>Chọn workspace theo công việc cần làm; kiểm tra kết quả đã lưu trước khi chuyển sang bước tiếp theo.</p>
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
