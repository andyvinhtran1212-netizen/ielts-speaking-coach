import type { Metadata } from 'next';
import Link from 'next/link';

import { CONTACT_CHANNELS, LEGAL_ROBOTS } from '../legal-content';
import { LegalShell } from '../legal-shell';

export const metadata: Metadata = {
  title: 'Liên hệ — Aver Learning',
  description: 'Kênh liên hệ Aver Learning về đăng ký khoá, thanh toán hoặc lỗi kỹ thuật.',
  alternates: { canonical: '/contact' },
  robots: LEGAL_ROBOTS,
};

export default function ContactPage() {
  return (
    <LegalShell title="Liên hệ">
      <h1 className="lg-h1">Liên hệ</h1>
      <p className="lg-lead">Hỏi về đăng ký khoá, thanh toán hoặc lỗi kỹ thuật. Chúng tôi trả lời qua email.</p>
      <section className="lg-card" aria-labelledby="kenh-lien-he">
        <h2 id="kenh-lien-he">Kênh liên hệ</h2>
        <dl className="lg-channels">
          {CONTACT_CHANNELS.map((channel) => (
            <div key={channel.label} className="lg-channels__row">
              <dt>{channel.label}</dt>
              <dd>{channel.value}</dd>
            </div>
          ))}
        </dl>
        <p className="lg-hint">Hỏi về thanh toán chuyển khoản: ghi rõ khoá và nội dung chuyển khoản trong tin nhắn.</p>
      </section>
      <p className="lg-hint">
        Xem <Link href="/privacy">Quyền riêng tư</Link> về cách chúng tôi dùng thông tin bạn gửi.
      </p>
    </LegalShell>
  );
}
