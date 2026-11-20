// UIBASE-0056 G03-T05 (FR-005): ChoiceGroup and StatusBadge.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChoiceGroup, StatusBadge, STATUS_BADGE_SETS } from '@/components/ui';

afterEach(cleanup);

describe('ChoiceGroup', () => {
  it('single: native radios in a fieldset named by the legend', () => {
    const onChange = vi.fn();
    render(
      <ChoiceGroup mode="single" legend="Chọn một" defaultValue="t1" onChange={onChange}
        options={[{ value: 't1', label: 'Task 1' }, { value: 't2', label: 'Task 2' }]} />,
    );
    expect(screen.getByRole('group', { name: 'Chọn một' }).tagName).toBe('FIELDSET');
    const t1 = screen.getByRole('radio', { name: 'Task 1' }) as HTMLInputElement;
    const t2 = screen.getByRole('radio', { name: 'Task 2' }) as HTMLInputElement;
    expect(t1.checked).toBe(true);
    expect(t1.name).toBe(t2.name);
    fireEvent.click(t2);
    expect(onChange).toHaveBeenCalledWith('t2');
  });

  it('multiple: checkboxes report every checked value', () => {
    const onChange = vi.fn();
    render(
      <ChoiceGroup mode="multiple" legend="Chọn nhiều" defaultValue={['overdue']} onChange={onChange}
        options={[{ value: 'overdue', label: 'Chỉ bài quá hạn' }, { value: 'hide', label: 'Ẩn bài đã chấm' }]} />,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ẩn bài đã chấm' }));
    expect(onChange).toHaveBeenLastCalledWith(['overdue', 'hide']);
  });

  it('controlled value wins; disabled options and error text', () => {
    render(
      <ChoiceGroup mode="single" legend="Kỳ thi" value="nov" error="Chọn một kỳ thi."
        options={[{ value: 'nov', label: 'Tháng 11' }, { value: 'oct', label: 'Tháng 10', disabled: true }]} />,
    );
    expect((screen.getByRole('radio', { name: 'Tháng 11' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('radio', { name: 'Tháng 10' }) as HTMLInputElement).disabled).toBe(true);
    const group = screen.getByRole('group', { name: 'Kỳ thi' });
    expect(document.getElementById(group.getAttribute('aria-describedby')!)?.textContent).toBe('Chọn một kỳ thi.');
  });
});

describe('StatusBadge', () => {
  it('uses the fixed Vietnamese words of ThanhPhan §3', () => {
    const words = Object.values(STATUS_BADGE_SETS).flatMap((set) => Object.values(set).map((e) => e.label));
    expect(words).toEqual([
      'Chưa làm', 'Đang làm', 'Đã nộp · chờ chấm', 'Đã chấm', 'Đã trả bài', 'Quá hạn',
      'Bản nháp', 'Đã phát hành', 'Lưu trữ',
      'Đang học', 'Sắp hết hạn', 'Hết hạn', 'Đã khoá',
    ]);
    expect(words.join(' ')).not.toMatch(/draft|published|live|graded/i);
  });

  it('appends the detail', () => {
    render(<><StatusBadge set="work" value="overdue" detail="2 ngày" /><StatusBadge set="access" value="expiring" detail="còn 7 ngày" /></>);
    expect(screen.getByText('Quá hạn 2 ngày')).toBeTruthy();
    expect(screen.getByText('Sắp hết hạn · còn 7 ngày')).toBeTruthy();
  });
});
