// /account/orders — Đơn đăng ký của tôi (ENROLL-0060 FR-041; sheet ThanhToan screen 7).
import type { Metadata } from 'next';

import { OrdersPage } from './orders-page';

export const metadata: Metadata = {
  title: 'Đơn đăng ký của tôi — Aver Learning',
  robots: { index: false, follow: false },
};

export default function Page() {
  return <OrdersPage />;
}
