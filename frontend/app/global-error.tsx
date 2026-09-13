'use client';

import { useEffect } from 'react';

import styles from './error-screen.module.css';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[aver] root boundary', error);
  }, [error]);

  return <html lang="vi"><head><link rel="stylesheet" href="/css/aver-design/tokens.css" /></head><body><main className={styles.page}>
    <section className={styles.card} aria-labelledby="global-error-title">
      <p className={styles.eyebrow}>Aver Learning · Hệ thống</p>
      <h1 className={styles.title} id="global-error-title">Không thể mở ứng dụng</h1>
      <p className={styles.copy}>Ứng dụng chưa tải hoàn chỉnh. Hãy thử lại; bài làm đã lưu trên máy chủ vẫn được giữ nguyên.</p>
      {error.digest ? <p className={styles.reference}>Mã tham chiếu: <code>{error.digest}</code></p> : null}
      <div className={styles.actions}>
        <button className={styles.primary} type="button" onClick={reset}>Tải lại ứng dụng</button>
        <a className={styles.secondary} href="/">Về trang chủ</a>
      </div>
    </section>
  </main></body></html>;
}
