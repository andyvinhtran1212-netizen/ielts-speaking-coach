// PUBLICSITE-0059 T04 — `/courses`, the public course catalogue (FR-004, 005,
// 006, 022, 023; tờ DanhMucKhoa, DanhMucKhoaMoiMotKhoa).
//
// Behind the build flag AVER_PUBLIC_COMMERCE (FR-029): off → a real 404.
// The server renders the guest view from GET /api/courses (cached, no token);
// a signed-in visitor's own `viewer` states are read in the browser by
// CourseCatalog. The read waits for a real request (connection()), so
// `next build` never needs a backend.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { Suspense } from 'react';

import { Button, PageState } from '@/components/ui';
import { getCatalog } from '@/lib/commerce-api';
import type { CourseItem } from '@/lib/commerce-types';
import { publicCommerceEnabled } from '@/lib/public-commerce.mjs';

import { CourseCatalog } from './course-catalog';
import styles from './courses.module.css';

export const metadata: Metadata = {
  title: 'Các khoá học — Aver Learning',
  description: 'Các khoá online, mỗi khoá dạy một kỹ năng IELTS. Đăng ký theo từng khoá, học riêng hay song song đều được.',
  alternates: { canonical: '/courses' },
};

async function CatalogBody() {
  await connection();
  let items: CourseItem[];
  try {
    items = (await getCatalog()).items ?? [];
  } catch {
    return (
      <PageState
        kind="error"
        title="Danh sách khoá học tạm thời chưa tải được"
        body="Bạn tải lại trang sau ít phút nhé."
        action={<Button href="/courses" variant="secondary">Tải lại</Button>}
      />
    );
  }
  return <CourseCatalog initialItems={items} />;
}

export default function CoursesPage() {
  if (!publicCommerceEnabled()) notFound();
  return (
    <div className={styles.page}>
      <header className={styles.intro}>
        <h1>Các khoá học</h1>
        <p>
          Mỗi khoá dạy một kỹ năng. Các khoá độc lập với nhau: bạn đăng ký khoá mình cần, học riêng hay song song đều
          được. Cùng một cách giảng và cùng hệ thuật ngữ, nên chuyển sang khoá khác không phải làm quen lại.
        </p>
        <p>
          Đăng ký theo từng khoá. Mỗi khoá có học phí, thời hạn truy cập và số lượt chấm AI riêng. Thanh toán bằng
          chuyển khoản, mở khoá sau khi xác nhận. Thư viện bài mẫu, ngữ pháp, từ vựng vẫn đọc miễn phí, không cần tài
          khoản.
        </p>
      </header>
      <Suspense fallback={<PageState kind="loading" title="Đang tải các khoá học…" />}>
        <CatalogBody />
      </Suspense>
    </div>
  );
}
