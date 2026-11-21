// UIBASE-0056 G03-T05 (FR-005): TextField, TextArea, Select, SearchField.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SearchField, Select, TextArea, TextField } from '@/components/ui';

afterEach(cleanup);

const describedText = (el: HTMLElement) =>
  (el.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent)
    .join(' | ');

describe('TextField', () => {
  it('the label names the input and the hint describes it', () => {
    render(<TextField label="Họ và tên" hint="Chữ mờ là ví dụ, không thay cho nhãn." placeholder="Ví dụ: Nguyễn Minh Anh" />);
    const input = screen.getByRole('textbox', { name: 'Họ và tên' });
    expect(describedText(input)).toBe('Chữ mờ là ví dụ, không thay cho nhãn.');
    expect(input.hasAttribute('aria-invalid')).toBe(false);
  });

  it('error: aria-invalid and the fix is read with the field, replacing the hint', () => {
    render(<TextField label="Mã kích hoạt" hint="Mã có 12 ký tự." error="Mã không đúng hoặc đã hết hạn." />);
    const input = screen.getByRole('textbox', { name: 'Mã kích hoạt' });
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(describedText(input)).toBe('Mã không đúng hoặc đã hết hạn.');
  });

  it('read-only says why', () => {
    render(<TextField label="Lớp" defaultValue="Tue–Thu 19:30" readOnlyReason="Lớp do giáo viên xếp." />);
    const input = screen.getByRole('textbox', { name: 'Lớp' }) as HTMLInputElement;
    expect(input.readOnly).toBe(true);
    expect(describedText(input)).toBe('Lớp do giáo viên xếp.');
  });

  it('onChange receives the new value', () => {
    const onChange = vi.fn();
    render(<TextField label="Email" type="email" value="" onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), { target: { value: 'a@b.vn' } });
    expect(onChange.mock.calls[0][0]).toBe('a@b.vn');
  });

  it('two fields get different ids', () => {
    render(<><TextField label="A" /><TextField label="B" /></>);
    expect(screen.getByRole('textbox', { name: 'A' }).id).not.toBe(screen.getByRole('textbox', { name: 'B' }).id);
  });
});

describe('TextArea', () => {
  it('reads the save status and word count with the field', () => {
    render(<TextArea label="Bài viết của bạn" saveStatus="Đã lưu lúc 10:42" wordCount={{ count: 0, limit: 250 }} />);
    const area = screen.getByRole('textbox', { name: 'Bài viết của bạn' });
    expect(area.tagName).toBe('TEXTAREA');
    expect(describedText(area)).toContain('Đã lưu lúc 10:42');
    expect(describedText(area)).toContain('0 / 250 từ');
  });

  it('error sets aria-invalid', () => {
    render(<TextArea label="Ghi chú" error="Bớt đi 32 ký tự." />);
    const area = screen.getByRole('textbox', { name: 'Ghi chú' });
    expect(area.getAttribute('aria-invalid')).toBe('true');
    expect(describedText(area)).toBe('Bớt đi 32 ký tự.');
  });
});

describe('Select', () => {
  it('is a native combobox with its options, named by the label', () => {
    const onChange = vi.fn();
    render(<Select label="Dạng đề" options={[{ value: '', label: 'Tất cả dạng đề' }, { value: 'opinion', label: 'Opinion' }]} onChange={onChange} />);
    const select = screen.getByRole('combobox', { name: 'Dạng đề' });
    expect(select.tagName).toBe('SELECT');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Tất cả dạng đề', 'Opinion']);
    fireEvent.change(select, { target: { value: 'opinion' } });
    expect(onChange.mock.calls[0][0]).toBe('opinion');
  });
});

describe('SearchField', () => {
  it('is a search landmark with a named searchbox (label hidden on screen only)', () => {
    render(<SearchField label="Tìm trong thư viện" />);
    expect(screen.getByRole('search', { name: 'Tìm trong thư viện' })).toBeTruthy();
    expect(screen.getByRole('searchbox', { name: 'Tìm trong thư viện' })).toBeTruthy();
  });

  it('no clear button while empty; Enter searches the trimmed query', () => {
    const onSearch = vi.fn();
    render(<SearchField label="Tìm" onSearch={onSearch} />);
    expect(screen.queryByRole('button', { name: 'Xoá nội dung tìm' })).toBeNull();
    const box = screen.getByRole('searchbox', { name: 'Tìm' });
    fireEvent.change(box, { target: { value: '  present perfect ' } });
    fireEvent.submit(box.closest('form')!);
    expect(onSearch).toHaveBeenCalledWith('present perfect');
  });

  it('the clear button empties the box, returns focus to it and searches ""', () => {
    const onSearch = vi.fn();
    render(<SearchField label="Tìm" defaultValue="tense" onSearch={onSearch} />);
    const box = screen.getByRole('searchbox', { name: 'Tìm' }) as HTMLInputElement;
    fireEvent.click(screen.getByRole('button', { name: 'Xoá nội dung tìm' }));
    expect(box.value).toBe('');
    expect(document.activeElement).toBe(box);
    expect(onSearch).toHaveBeenCalledWith('');
    expect(screen.queryByRole('button', { name: 'Xoá nội dung tìm' })).toBeNull();
  });
});
