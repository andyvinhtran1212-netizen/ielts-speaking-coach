// LEARNERCORE-0063 FR-062: /help search, empty state, toggles and live links.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { HelpPage } from '@/app/(authed-v2-help)/help/help-page';

afterEach(() => cleanup());

describe('/help', () => {
  it('six group headings, every question a closed toggle', () => {
    render(<HelpPage />);
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(6);
    const toggle = screen.getByRole('button', { name: /Một lượt chấm AI là gì\?/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText(/1 lượt = 1 bài Writing/)).toBeTruthy();
  });

  it('accent-free search: "hoc phi" finds the answer with "học phí" and opens it', () => {
    render(<HelpPage />);
    fireEvent.change(screen.getByLabelText('Tìm trong Trợ giúp'), { target: { value: 'hoc phi' } });
    expect(screen.getByRole('status').textContent).toMatch(/^Tìm thấy \d+ câu trả lời\.$/);
    const toggle = screen.getByRole('button', { name: /Khoá online và khoá của lớp khác nhau/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('no match: the empty state, then "Xoá ô tìm" brings every group back', () => {
    render(<HelpPage />);
    fireEvent.change(screen.getByLabelText('Tìm trong Trợ giúp'), { target: { value: 'hoá đơn công ty' } });
    expect(screen.getByRole('heading', { name: 'Chưa có câu trả lời cho “hoá đơn công ty”' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Không có câu trả lời nào khớp.');
    fireEvent.click(screen.getByRole('button', { name: 'Xoá ô tìm, xem mọi nhóm' }));
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(6);
  });

  it('links only to live routes: /profile shows, planned /courses does not', () => {
    render(<HelpPage />);
    fireEvent.change(screen.getByLabelText('Tìm trong Trợ giúp'), { target: { value: 'email' } });
    const profile = screen.getByRole('link', { name: 'Mở Hồ sơ' });
    expect(profile.getAttribute('href')).toBe('/profile');
    fireEvent.change(screen.getByLabelText('Tìm trong Trợ giúp'), { target: { value: 'vietqr' } });
    const item = screen.getByRole('button', { name: /Đăng ký khoá online thế nào\?/ }).closest('li')!;
    expect(within(item).queryByRole('link')).toBeNull();
  });
});
