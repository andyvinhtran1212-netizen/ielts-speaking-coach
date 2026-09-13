'use client';

import Link from 'next/link';
import { useEffect } from 'react';

import styles from './error-screen.module.css';

export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    const reporter = (window as any).aver?.reportError;
    if (typeof reporter === 'function') reporter(error, { surface: 'next-route-boundary' });
    else console.error('[aver] route boundary', error);
  }, [error]);

  return <main className={styles.page}>
    <section className={styles.card} aria-labelledby="route-error-title">
      <p className={styles.eyebrow}>Aver Learning · Khôi phục an toàn</p>
      <h1 className={styles.title} id="route-error-title">Trang này vừa gặp sự cố</h1>
      <p className={styles.copy}>Dữ liệu đã lưu trước đó không bị thay đổi. Bạn có thể thử tải lại phần này; nếu lỗi còn lặp lại, hãy gửi mã tham chiếu cho quản trị viên.</p>
      {error.digest ? <p className={styles.reference}>Mã tham chiếu: <code>{error.digest}</code></p> : null}
      <div className={styles.actions}>
        <button className={styles.primary} type="button" onClick={reset}>Thử lại</button>
        <Link className={styles.secondary} href="/">Về trang chủ</Link>
      </div>
    </section>
  </main>;
}
