// /account — Tài khoản (LEARNERCORE-0063 FR-060, FR-087; sheet TaiKhoan).
import type { Metadata } from 'next';

import { AccountPage } from './account-page';

export const metadata: Metadata = {
  title: 'Tài khoản — Aver Learning',
  robots: { index: false, follow: false },
};

export default function Page() {
  return <AccountPage />;
}
