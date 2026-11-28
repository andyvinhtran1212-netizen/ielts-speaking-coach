// /enroll/[orderCode] — one enrollment order (ENROLL-0060 FR-037…FR-040,
// FR-055, FR-056; sheet ThanhToan screens 2–6).
import type { Metadata } from 'next';

import { EnrollOrderPage } from './enroll-order-page';

export const metadata: Metadata = {
  title: 'Đơn đăng ký — Aver Learning',
  robots: { index: false, follow: false },
};

export default async function Page({ params }: { params: Promise<{ orderCode: string }> }) {
  const { orderCode } = await params;
  let code = orderCode;
  try { code = decodeURIComponent(orderCode); } catch { /* keep the raw segment */ }
  return <EnrollOrderPage code={code} />;
}
