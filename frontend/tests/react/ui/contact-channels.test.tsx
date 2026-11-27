// PUBLICSITE-0059 FR-026 (G05-T23): shared contact block. Fixture values are
// fake (example.com and a made-up number), never a real channel.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ContactChannels } from '@/components/ui';

afterEach(cleanup);

const FULL = {
  email: 'hotro@example.com',
  phone: '0900 000 001', // fake number for tests
  zalo: 'https://zalo.me/0900000001', // fake number for tests
  reply_hours: '8:00–21:00, thứ Hai đến thứ Bảy',
};

function labels(container: HTMLElement) {
  return [...container.querySelectorAll('dt')].map((dt) => dt.textContent);
}

describe('ContactChannels', () => {
  it('shows all four lines in the order Email · Điện thoại · Zalo · Giờ trả lời', () => {
    const { container } = render(<ContactChannels contact={FULL} title="Liên hệ trực tiếp" />);
    expect(labels(container)).toEqual(['Email', 'Điện thoại', 'Zalo', 'Giờ trả lời']);
    expect(screen.getByRole('link', { name: 'hotro@example.com' }).getAttribute('href')).toBe('mailto:hotro@example.com');
    expect(screen.getByRole('link', { name: '0900 000 001' }).getAttribute('href')).toBe('tel:0900000001');
    expect(screen.getByRole('link', { name: FULL.zalo }).getAttribute('href')).toBe(FULL.zalo);
    expect(screen.getByText(FULL.reply_hours).closest('a')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Liên hệ trực tiếp' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /trang Liên hệ/ })).toBeNull();
  });

  it('leaves out a line without a value', () => {
    const { container } = render(<ContactChannels contact={{ ...FULL, zalo: null }} />);
    expect(labels(container)).toEqual(['Email', 'Điện thoại', 'Giờ trả lời']);
  });

  it('becomes a link to /contact when all four are empty, with no placeholder', () => {
    const { container } = render(
      <ContactChannels contact={{ email: null, phone: '  ', zalo: '', reply_hours: null }} />,
    );
    expect(container.querySelector('dl')).toBeNull();
    expect(screen.getByRole('link', { name: 'Gửi lời nhắn qua trang Liên hệ' }).getAttribute('href')).toBe('/contact');
    expect(container.textContent).not.toContain('XXX');
  });

  it('never prints a placeholder value such as "0900 XXX XXX"', () => {
    const { container } = render(<ContactChannels contact={{ ...FULL, phone: '0900 XXX XXX' }} />);
    expect(labels(container)).toEqual(['Email', 'Zalo', 'Giờ trả lời']);
    expect(container.textContent).not.toContain('XXX');
  });

  it('shows a Zalo name or number as text, not as a link', () => {
    render(<ContactChannels contact={{ zalo: 'Aver Learning' }} />);
    expect(screen.getByText('Aver Learning').closest('a')).toBeNull();
  });

  it('a missing source is the /contact link', () => {
    render(<ContactChannels contact={null} />);
    expect(screen.getByRole('link', { name: 'Gửi lời nhắn qua trang Liên hệ' })).toBeTruthy();
  });
});
