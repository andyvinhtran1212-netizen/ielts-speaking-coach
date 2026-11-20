// UIBASE-0056 G03-T07 (FR-005): Tabs, Breadcrumb/BackLink, Pagination, ProgressBar, Stepper.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { BackLink, Breadcrumb, formatCount, Pagination, ProgressBar, Stepper, Tabs } from '@/components/ui';

afterEach(cleanup);

const ITEMS = [
  { id: 'assigned', label: 'Bài được giao', count: 4 },
  { id: 'submitted', label: 'Bài đã nộp' },
  { id: 'bank', label: 'Kho đề' },
];

function TabsHarness() {
  const [active, setActive] = useState('assigned');
  return (
    <Tabs label="Bài của tôi" items={ITEMS} active={active} onChange={setActive}>
      <p>Nội dung {active}</p>
    </Tabs>
  );
}

describe('Tabs', () => {
  it('is a tablist with one selected, focusable tab controlling the panel', () => {
    render(<TabsHarness />);
    const list = screen.getByRole('tablist', { name: 'Bài của tôi' });
    const tabs = within(list).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Bài được giao (4)', 'Bài đã nộp', 'Kho đề']);
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    expect(tabs.map((t) => t.tabIndex)).toEqual([0, -1, -1]);
    const panel = screen.getByRole('tabpanel', { name: 'Bài được giao (4)' });
    expect(tabs[0].getAttribute('aria-controls')).toBe(panel.id);
  });

  it('arrow keys, Home and End move focus and select (wrapping)', () => {
    render(<TabsHarness />);
    const first = screen.getByRole('tab', { name: 'Bài được giao (4)' });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Kho đề' }));
    expect(screen.getByRole('tabpanel').textContent).toBe('Nội dung bank');
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(screen.getByRole('tab', { name: 'Bài được giao (4)' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(document.activeElement?.textContent).toBe('Bài đã nộp');
    fireEvent.click(screen.getByRole('tab', { name: 'Kho đề' }));
    expect(screen.getByRole('tabpanel').textContent).toBe('Nội dung bank');
  });

  it('with href on every item it is a nav of links, the active one aria-current', () => {
    render(<Tabs label="Kho đề" active="w" items={[{ id: 'w', label: 'Writing', href: '/w' }, { id: 's', label: 'Speaking', href: '/s' }]} />);
    expect(screen.queryByRole('tablist')).toBeNull();
    const nav = screen.getByRole('navigation', { name: 'Kho đề' });
    expect(within(nav).getByRole('link', { name: 'Writing' }).getAttribute('aria-current')).toBe('page');
    expect(within(nav).getByRole('link', { name: 'Speaking' }).hasAttribute('aria-current')).toBe(false);
  });
});

describe('Breadcrumb and BackLink', () => {
  it('lists the trail; the current page is the last item and not a link', () => {
    render(<Breadcrumb items={[{ label: 'Luyện tập', href: '/practice' }, { label: 'Listening', href: '/listening' }, { label: 'Day 54' }]} />);
    const nav = screen.getByRole('navigation', { name: 'Vị trí trang' });
    expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual(['Luyện tập', 'Listening']);
    expect(within(nav).getByText('Day 54').getAttribute('aria-current')).toBe('page');
  });

  it('also carries the phone back link to the nearest parent, named with its words', () => {
    render(<Breadcrumb items={[{ label: 'Luyện tập', href: '/practice' }, { label: 'Listening', href: '/listening' }, { label: 'Day 54' }]} />);
    const back = screen.getByRole('link', { name: 'Quay lại Listening' });
    expect(back.getAttribute('href')).toBe('/listening');
  });

  it('a top-level page has no trail', () => {
    const { container } = render(<Breadcrumb items={[{ label: 'Luyện tập' }]} />);
    expect(container.textContent).toBe('');
  });

  it('BackLink names where it goes', () => {
    render(<BackLink parentLabel="Writing" href="/writing" />);
    const link = screen.getByRole('link', { name: 'Quay lại Writing' });
    expect(link.textContent).toBe('‹Writing');
  });
});

describe('Pagination', () => {
  const hrefFor = (p: number) => `/library?page=${p}`;

  it('says where you are and links both ways', () => {
    render(<Pagination page={2} totalPages={11} totalLabel="549 đề" hrefFor={hrefFor} />);
    const nav = screen.getByRole('navigation', { name: 'Phân trang' });
    expect(nav.textContent).toContain('Trang 2 trên 11 · 549 đề');
    expect(within(nav).getByRole('link', { name: 'Trang trước' }).getAttribute('href')).toBe('/library?page=1');
    expect(within(nav).getByRole('link', { name: 'Trang sau' }).getAttribute('href')).toBe('/library?page=3');
  });

  it('disables "Trước" on the first page and "Sau" on the last', () => {
    const { rerender } = render(<Pagination page={1} totalPages={3} hrefFor={hrefFor} />);
    expect(screen.getByRole('link', { name: 'Trang trước' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('link', { name: 'Trang trước' }).hasAttribute('href')).toBe(false);
    rerender(<Pagination page={3} totalPages={3} hrefFor={hrefFor} />);
    expect(screen.getByRole('link', { name: 'Trang sau' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('link', { name: 'Trang trước' }).getAttribute('href')).toBe('/library?page=2');
  });

  it('is not rendered for a single page', () => {
    const { container } = render(<Pagination page={1} totalPages={1} hrefFor={hrefFor} />);
    expect(container.textContent).toBe('');
  });
});

describe('ProgressBar', () => {
  it('determinate: says "13 trên 48 bài" in text and in aria-valuetext', () => {
    render(<ProgressBar label="Lộ trình Writing" value={13} total={48} unit="bài" />);
    const bar = screen.getByRole('progressbar', { name: 'Lộ trình Writing' });
    expect(bar.getAttribute('aria-valuenow')).toBe('13');
    expect(bar.getAttribute('aria-valuemax')).toBe('48');
    expect(bar.getAttribute('aria-valuetext')).toBe('13 trên 48 bài');
    expect(screen.getByText('13 trên 48 bài')).toBeTruthy();
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it('full: says "Đã xong"', () => {
    render(<ProgressBar label="Lộ trình Listening" value={48} total={48} unit="bài" />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuetext')).toBe('48 trên 48 bài, đã xong');
    expect(screen.getByText('Đã xong')).toBeTruthy();
  });

  it('indeterminate: no value, "Đang xử lý" in words', () => {
    render(<ProgressBar mode="indeterminate" label="Đang chấm bài Writing" />);
    const bar = screen.getByRole('progressbar', { name: 'Đang chấm bài Writing' });
    expect(bar.hasAttribute('aria-valuenow')).toBe(false);
    expect(bar.getAttribute('aria-valuetext')).toBe('Đang xử lý');
  });

  it('steps: "Bước 2 trên 4, Kiểm tra thử"', () => {
    render(<ProgressBar mode="steps" label="Nhập danh sách" value={2} total={4} stepLabel="Kiểm tra thử" />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuetext')).toBe('Bước 2 trên 4, Kiểm tra thử');
  });

  it('formats thousands with a no-break space', () => {
    expect(formatCount(1284)).toBe('1 284');
    expect(formatCount(549)).toBe('549');
  });
});

describe('Stepper', () => {
  it('lists the steps with their state in words and marks the current one', () => {
    render(
      <Stepper
        label="Các bước nhập dữ liệu"
        steps={[
          { label: 'Chọn file', status: 'done', href: '/import/1' },
          { label: 'Kiểm tra thử', status: 'error', note: 'Có lỗi · 12 dòng cần sửa' },
          { label: 'Xác nhận', status: 'locked' },
          { label: 'Xong', status: 'todo' },
        ]}
      />,
    );
    const list = screen.getByRole('list', { name: 'Các bước nhập dữ liệu' });
    const items = within(list).getAllByRole('listitem');
    expect(items.map((li) => li.getAttribute('aria-current'))).toEqual([null, 'step', null, null]);
    expect(within(items[0]).getByRole('link', { name: 'Chọn file' })).toBeTruthy();
    expect(within(items[1]).getByText('Có lỗi · 12 dòng cần sửa')).toBeTruthy();
    expect(within(items[2]).queryByRole('link')).toBeNull();
    expect(within(items[3]).getByText('Chưa tới')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuetext')).toBe('Bước 2 trên 4, Kiểm tra thử');
    expect(screen.getByText('Kiểm tra thử: Có lỗi · 12 dòng cần sửa')).toBeTruthy();
  });
});
