// UIBASE-0056 G03-T13 (FR-011): the public shell for guests.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { PublicShell } from '@/components/ui/shell/public-shell';

afterEach(cleanup);

const hrefs = (root: HTMLElement) => within(root).getAllByRole('link').map((a) => a.getAttribute('href'));
const names = (root: HTMLElement) => within(root).getAllByRole('link').map((a) => a.textContent);

describe('PublicTopNav', () => {
  it('has Thư viện · Khoá học, a text "Đăng nhập" and one primary "Xem các khoá"', () => {
    render(<PublicShell><p>nội dung</p></PublicShell>);
    expect(names(screen.getByRole('navigation', { name: 'Khu công khai' }))).toEqual(['Thư viện', 'Khoá học']);
    expect(screen.getByRole('link', { name: 'Đăng nhập' }).getAttribute('href')).toBe('/login');
    // CẦN ANH ANDY QUYẾT: /courses does not exist yet (G05), so both go home for now.
    expect(screen.getByRole('link', { name: 'Xem các khoá' }).getAttribute('href')).toBe('/');
    expect(screen.getAllByRole('link', { name: 'Xem các khoá' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: /Đổi giao diện/ })).toBeTruthy();
    expect(screen.getByRole('main').textContent).toBe('nội dung');
  });

  it('marks the active section, and none by default', () => {
    const { rerender } = render(<PublicShell><p /></PublicShell>);
    const nav = () => screen.getByRole('navigation', { name: 'Khu công khai' });
    expect(nav().querySelector('[aria-current]')).toBeNull();
    rerender(<PublicShell active="library"><p /></PublicShell>);
    expect(within(nav()).getByRole('link', { name: 'Thư viện' }).getAttribute('aria-current')).toBe('page');
    expect(within(nav()).getByRole('link', { name: 'Khoá học' }).hasAttribute('aria-current')).toBe(false);
  });

  it('opens the phone menu, closes it with Esc and returns focus to the button', () => {
    render(<PublicShell><p /></PublicShell>);
    const button = screen.getByRole('button', { name: 'Mở menu' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const menu = screen.getByRole('navigation', { name: 'Menu khu công khai' });
    expect(document.getElementById(button.getAttribute('aria-controls')!)?.contains(menu)).toBe(true);
    expect(names(menu)).toEqual(['Thư viện', 'Khoá học']);
    // "Đăng nhập" stays on the bar, outside the menu.
    expect(within(menu).queryByRole('link', { name: 'Đăng nhập' })).toBeNull();
    expect(screen.getByRole('group', { name: 'Giao diện' })).toBeTruthy();

    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('navigation', { name: 'Menu khu công khai' })).toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(button);
  });

  it('adds mobileExtraItem as one row of the phone menu only when passed', () => {
    render(<PublicShell mobileExtraItem={{ label: 'Chấm thử', href: '/cham-thu' }}><p /></PublicShell>);
    expect(screen.queryByRole('link', { name: 'Chấm thử' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Mở menu' }));
    const menu = screen.getByRole('navigation', { name: 'Menu khu công khai' });
    expect(names(menu)).toEqual(['Thư viện', 'Khoá học', 'Chấm thử']);
    expect(within(menu).getByRole('link', { name: 'Chấm thử' }).getAttribute('href')).toBe('/cham-thu');
  });

  it('closes the phone menu on a tap outside', () => {
    render(<PublicShell><p data-testid="outside" /></PublicShell>);
    fireEvent.click(screen.getByRole('button', { name: 'Mở menu' }));
    fireEvent.pointerDown(screen.getByTestId('outside'));
    expect(screen.queryByRole('navigation', { name: 'Menu khu công khai' })).toBeNull();
  });
});

describe('PublicFooter', () => {
  it('lists the six links in the fixed order and the copyright', () => {
    render(<PublicShell><p /></PublicShell>);
    const footer = screen.getByRole('navigation', { name: 'Chân trang' });
    expect(names(footer)).toEqual(['Giới thiệu', 'Khoá học', 'Thư viện', 'Điều khoản', 'Quyền riêng tư', 'Liên hệ']);
    expect(hrefs(footer)).toEqual(['/about', '/', '/grammar', '/terms', '/privacy', '/contact']);
    expect(screen.getByRole('contentinfo').textContent).toContain('© 2026 Aver Learning');
  });
});

