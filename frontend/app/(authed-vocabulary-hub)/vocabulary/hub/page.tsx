import type { Metadata } from 'next';
import { Suspense } from 'react';

import { VocabularyHubBehavior } from './vocabulary-hub-behavior';

export const metadata: Metadata = {
  title: 'Từ vựng — Aver Learning',
  robots: { index: false, follow: false },
};

export default function VocabularyHubPage() {
  return (
    <>
      {/* PC-J147: trang tự đọc /auth/me (cờ tính năng) rồi chuyển role cho chrome,
          để chrome không gửi /auth/me thứ hai chen trước /api/vocabulary-sets. */}
      {/* @ts-ignore — custom element do aver-chrome.js đăng ký. */}
      <aver-chrome active="vocabulary" role-source="page" />
      <Suspense fallback={<p role="status">Đang tải từ vựng…</p>}><VocabularyHubBehavior /></Suspense>
    </>
  );
}
