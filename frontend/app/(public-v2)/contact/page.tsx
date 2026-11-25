import type { Metadata } from 'next';

import { CONTACT_CHANNELS, LEGAL_ROBOTS } from '../legal-content';
import { LegalPage } from '../legal-page';
import styles from '../legal.module.css';

export const metadata: Metadata = {
  title: 'Liên hệ — Aver Learning',
  description: 'Kênh liên hệ Aver Learning về đăng ký khoá, thanh toán hoặc lỗi kỹ thuật.',
  alternates: { canonical: '/contact' },
  robots: LEGAL_ROBOTS,
};

// PhapLy.dc.html §2. The contact form of the sheet is G05-T06/T07's work (it
// needs a backend endpoint); until then the page lists the shared channels.
export default function ContactPage() {
  return (
    <LegalPage title="Liên hệ" lead="Hỏi về đăng ký khoá, thanh toán hoặc lỗi kỹ thuật. Chúng tôi trả lời qua email.">
      <section className={styles.channels} aria-labelledby="kenh-lien-he">
        <h2 id="kenh-lien-he">Kênh liên hệ</h2>
        <dl className={styles.channelList}>
          {CONTACT_CHANNELS.map((channel) => (
            <div key={channel.label}>
              <dt>{channel.label}</dt>
              <dd>{channel.value}</dd>
            </div>
          ))}
        </dl>
        <p className={styles.hint}>Hỏi về thanh toán chuyển khoản: ghi rõ khoá và nội dung chuyển khoản trong tin nhắn.</p>
      </section>
      <p className={styles.hint}>
        Xem <a href="/privacy">Quyền riêng tư</a> về cách chúng tôi dùng thông tin bạn gửi.
      </p>
    </LegalPage>
  );
}
