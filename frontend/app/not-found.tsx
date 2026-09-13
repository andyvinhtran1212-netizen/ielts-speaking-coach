import Link from 'next/link';

import styles from './error-screen.module.css';

export default function NotFound() {
  return <main className={styles.page}>
    <section className={styles.card} aria-labelledby="not-found-title">
      <p className={styles.eyebrow}>404 · Không tìm thấy</p>
      <h1 className={styles.title} id="not-found-title">Trang này không còn ở đây</h1>
      <p className={styles.copy}>Đường dẫn có thể đã thay đổi hoặc nội dung chưa được xuất bản. Hãy quay lại trang chủ để tiếp tục học.</p>
      <div className={styles.actions}>
        <Link className={styles.primary} href="/">Về trang chủ</Link>
        <Link className={styles.secondary} href="/grammar">Mở Grammar Wiki</Link>
      </div>
    </section>
  </main>;
}
