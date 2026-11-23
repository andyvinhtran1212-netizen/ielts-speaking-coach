import { EnvBadge } from '@/components/ui/shell/staff-top-bar';

import { StaffShellDemo } from './staff-demo';
import { PLANNED_ONLY } from './staff-sample';
import styles from './ui-library.module.css';

/**
 * G03-T16 (FR-010, FR-018). The shell follows the window width: from 1200px
 * the sidebar has labels; 768–1199px (1024px included) icons only; below
 * 768px a menu button opens the drawer and the environment becomes a strip.
 */
export function StaffShellSection({ title }: { title: string }) {
  return (
    <section id="staff-shell" className={styles.section} aria-labelledby="staff-shell-h">
      <h2 id="staff-shell-h">{title}</h2>
      <p>
        Khung quản trị đổi theo bề rộng cửa sổ: từ 1200px thanh bên có chữ; 768–1199px chỉ biểu tượng; dưới 768px
        nút menu mở ngăn kéo. Bấm ⌘K hoặc Ctrl+K rồi gõ &ldquo;minh&rdquo;; bấm tên nhóm để thu hoặc mở.
      </p>
      <h3>Quản trị · Production · trang hiện tại Chấm bài › Writing</h3>
      <StaffShellDemo testId="staff-shell-admin" />

      <h3>Quản trị · Staging · thanh bên tự thu</h3>
      <StaffShellDemo testId="staff-shell-staging" environment="staging" demo={{ current: '/admin/writing/queue', collapsed: true }} />

      <h3>Giáo viên · mục phẳng · trang đầu Việc của tôi</h3>
      <StaffShellDemo testId="staff-shell-instructor" role="instructor" />

      <h3>Nhãn môi trường</h3>
      <div className={styles.demoRow}>
        <EnvBadge environment="production" />
        <EnvBadge environment="staging" />
        <EnvBadge environment="local" />
      </div>
      <p className={styles.demoCrumb}>
        Mục chưa có trang chạy thật nên chưa hiện (G09 thêm khi trang có): {PLANNED_ONLY.join(' · ')}.
      </p>
    </section>
  );
}
