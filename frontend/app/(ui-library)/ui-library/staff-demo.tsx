'use client';

import type { ReactNode } from 'react';

import { StaffShell, type StaffShellProps } from '@/components/ui/shell/staff-shell';

import {
  SAMPLE_ADMIN_NAV, SAMPLE_INSTRUCTOR_NAV, SAMPLE_STAFF_ADMIN, SAMPLE_STAFF_INSTRUCTOR, sampleStaffSearch,
} from './staff-sample';
import styles from './ui-library.module.css';

type DemoProps = Partial<Omit<StaffShellProps, 'children'>> & { children?: ReactNode; testId?: string };

/** StaffShell with the sheet's data; current page "Chấm bài › Writing". */
export function StaffShellDemo({ children, testId, ...props }: DemoProps) {
  const role = props.role ?? 'admin';
  return (
    <div className={`${styles.shellFrame} ${styles.staffFrame}`} data-testid={testId}>
      <StaffShell
        role={role}
        nav={role === 'admin' ? SAMPLE_ADMIN_NAV : SAMPLE_INSTRUCTOR_NAV}
        environment="production"
        user={role === 'admin' ? SAMPLE_STAFF_ADMIN : SAMPLE_STAFF_INSTRUCTOR}
        switchTo={role === 'admin' ? [{ label: 'Sang khu giáo viên', href: '/instructor' }, { label: 'Sang khu học viên', href: '/home' }] : []}
        search={sampleStaffSearch}
        demo={{ current: role === 'admin' ? '/admin/writing/queue' : '/instructor' }}
        {...props}
      >
        {children ?? (
          <>
            <p className={styles.demoCrumb}>{role === 'admin' ? 'Chấm bài › Writing' : 'Việc của tôi'}</p>
            <p className={styles.demoContent}>[Nội dung trang]</p>
          </>
        )}
      </StaffShell>
    </div>
  );
}
