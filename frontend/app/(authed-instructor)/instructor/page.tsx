import type { Metadata } from 'next';

import { InstructorDashboard } from './instructor-dashboard';

export const metadata: Metadata = {
  title: 'Trang giảng viên · Aver Learning',
  robots: { index: false, follow: false },
};

export default function InstructorPage() {
  return <InstructorDashboard />;
}
