// EXAMROOM-0066 T004 (G08-T05) FR-030, FR-032: Highlight / Note on the passage.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  addMark, AnnotationLayer, clearMarks, marksKey, MARKS_TTL_MS, readMarks, writeMarks,
} from '@/components/exam-room/annotation-layer';

const KEY = marksKey('reading', 'user-1', 'att-1');
const TEXT = 'The first passage describes ancient irrigation in detail.';

const originalRects = Range.prototype.getClientRects;
beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); Range.prototype.getClientRects = originalRects; });

function selectText(container: HTMLElement, start: number, end: number) {
  const p = container.querySelector('p') as HTMLParagraphElement;
  const node = p.firstChild as Text;
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  fireEvent.mouseUp(p);
}

function layer(props: Partial<Parameters<typeof AnnotationLayer>[0]> = {}) {
  return render(
    <AnnotationLayer surface="reading" ownerKey="user-1" attemptKey="att-1" {...props}>
      <p>{TEXT}</p>
    </AnnotationLayer>,
  );
}

describe('mark model', () => {
  it('merges overlapping highlights and keeps notes apart', () => {
    let marks = addMark([], 4, 9, 'a');
    marks = addMark(marks, 7, 15, 'b');
    expect(marks).toEqual([{ id: 'b', start: 4, end: 15 }]);
    marks = addMark(marks, 5, 8, 'n', 'check');
    expect(marks).toHaveLength(2);
    expect(clearMarks(marks, 6, 6)).toEqual([]);
  });

  it('stores per attempt and owner for 30 days, then reads as nothing', () => {
    expect(KEY).toBe('exam-room:marks:reading:user-1:att-1');
    const now = 1_000_000;
    expect(writeMarks(window.localStorage, KEY, [{ id: 'a', start: 0, end: 3 }], now)).toBe(true);
    expect(readMarks(window.localStorage, KEY, now + MARKS_TTL_MS - 1)).toHaveLength(1);
    expect(readMarks(window.localStorage, KEY, now + MARKS_TTL_MS)).toEqual([]);
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('broken or blocked storage never throws', () => {
    window.localStorage.setItem(KEY, '{nope');
    expect(readMarks(window.localStorage, KEY)).toEqual([]);
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => {} } as unknown as Storage;
    expect(readMarks(blocked, KEY)).toEqual([]);
    expect(writeMarks(blocked, KEY, [{ id: 'a', start: 0, end: 3 }])).toBe(false);
  });
});

describe('AnnotationLayer', () => {
  it('selecting text shows Highlight · Note in English; Highlight keeps the mark after reload', () => {
    const { container, unmount } = layer();
    selectText(container, 4, 9);
    const bar = screen.getByRole('toolbar', { name: 'Annotation tools' });
    expect(bar.getAttribute('lang')).toBe('en');
    fireEvent.click(screen.getByRole('button', { name: 'Highlight' }));
    expect(readMarks(window.localStorage, KEY)).toEqual([expect.objectContaining({ start: 4, end: 9 })]);
    unmount();
    layer();
    expect(readMarks(window.localStorage, KEY)).toHaveLength(1);
  });

  it('Note asks for text and lists it in the margin', () => {
    const { container } = layer();
    selectText(container, 10, 17);
    fireEvent.click(screen.getByRole('button', { name: 'Note' }));
    fireEvent.change(screen.getByLabelText('Note text'), { target: { value: 'main idea' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }));
    const margin = screen.getByRole('complementary', { name: 'Notes' });
    expect(margin.textContent).toContain('main idea');
    expect(readMarks(window.localStorage, KEY)[0]).toEqual(expect.objectContaining({ start: 10, end: 17, note: 'main idea' }));
  });

  it('Clear removes the marks under the selection', () => {
    writeMarks(window.localStorage, KEY, [{ id: 'a', start: 4, end: 9 }]);
    const { container } = layer();
    selectText(container, 5, 7);
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(readMarks(window.localStorage, KEY)).toEqual([]);
  });

  it('another account on the same browser does not see the marks', () => {
    writeMarks(window.localStorage, KEY, [{ id: 'a', start: 4, end: 9, note: 'mine' }]);
    render(<AnnotationLayer surface="reading" ownerKey="user-2" attemptKey="att-1"><p>{TEXT}</p></AnnotationLayer>);
    expect(screen.queryByText('mine')).toBeNull();
  });

  it('paints with the CSS Highlight API when the browser has it', () => {
    const set = vi.fn();
    const del = vi.fn();
    class FakeHighlight { ranges: Range[]; constructor(...r: Range[]) { this.ranges = r; } }
    vi.stubGlobal('CSS', { highlights: { set, delete: del } });
    vi.stubGlobal('Highlight', FakeHighlight);
    writeMarks(window.localStorage, KEY, [{ id: 'a', start: 4, end: 9 }]);
    const { container } = layer();
    expect(set).toHaveBeenCalledWith('exam-room-mark', expect.any(FakeHighlight));
    expect((set.mock.calls.at(-1)![1] as FakeHighlight).ranges[0].toString()).toBe('first');
    expect(container.querySelector('mark')).toBeNull();
  });

  it('falls back to <mark> boxes without the API and leaves the passage DOM alone', () => {
    vi.stubGlobal('CSS', {});
    const rect = { top: 10, left: 20, width: 40, height: 16, right: 60, bottom: 26, x: 20, y: 10, toJSON() {} } as DOMRect;
    Range.prototype.getClientRects = vi.fn(() => [rect] as unknown as DOMRectList);
    writeMarks(window.localStorage, KEY, [{ id: 'a', start: 4, end: 9 }]);
    const { container } = layer();
    const marks = container.querySelectorAll('mark');
    expect(marks).toHaveLength(1);
    expect(marks[0].getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('p')!.textContent).toBe(TEXT);
    expect(container.querySelector('p')!.children).toHaveLength(0);
  });

  it('narrow: a numbered button opens the note', () => {
    vi.stubGlobal('CSS', {});
    const rect = { top: 10, left: 20, width: 40, height: 16, right: 60, bottom: 26, x: 20, y: 10, toJSON() {} } as DOMRect;
    Range.prototype.getClientRects = vi.fn(() => [rect] as unknown as DOMRectList);
    writeMarks(window.localStorage, KEY, [{ id: 'n', start: 4, end: 9, note: 'date' }]);
    layer({ narrow: true });
    const item = screen.getByText('date').closest('li')!;
    expect(item.hidden).toBe(true);
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Note 1' })); });
    expect(item.hidden).toBe(false);
  });

  it('switching account on the same instance never shows or saves the old marks (FR-032, CR HOLD)', () => {
    const KEY2 = marksKey('reading', 'user-2', 'att-1');
    writeMarks(window.localStorage, KEY, [{ id: 'a', start: 4, end: 9, note: 'mine' }]);
    const seen: string[] = [];
    const Probe = () => { useLayoutEffect(() => { seen.push(document.body.textContent ?? ''); }); return null; };
    const { container, rerender } = layer();
    expect(screen.getByText('mine')).toBeTruthy();
    // An open note editor with an unsaved draft for user-1.
    selectText(container, 10, 17);
    fireEvent.click(screen.getByRole('button', { name: 'Note' }));
    fireEvent.change(screen.getByLabelText('Note text'), { target: { value: 'draft of user-1' } });
    seen.length = 0;
    rerender(<AnnotationLayer surface="reading" ownerKey="user-2" attemptKey="att-1"><p>{TEXT}</p><Probe /></AnnotationLayer>);
    // No committed render with the new key shows the old note or the old draft.
    expect(seen.some((t) => t.includes('mine'))).toBe(false);
    expect(screen.queryByText('mine')).toBeNull();
    expect(screen.queryByLabelText('Note text')).toBeNull();
    expect(screen.queryByRole('complementary', { name: 'Notes' })).toBeNull();
    // A new highlight is saved for user-2 only, without user-1's marks.
    selectText(container, 0, 3);
    fireEvent.click(screen.getByRole('button', { name: 'Highlight' }));
    expect(readMarks(window.localStorage, KEY2)).toEqual([expect.objectContaining({ start: 0, end: 3 })]);
    expect(readMarks(window.localStorage, KEY)).toEqual([{ id: 'a', start: 4, end: 9, note: 'mine' }]);
  });

  it('switching attempt on the same instance shows that attempt\'s marks only', () => {
    const KEY_B = marksKey('reading', 'user-1', 'att-2');
    writeMarks(window.localStorage, KEY, [{ id: 'a', start: 4, end: 9, note: 'first attempt' }]);
    writeMarks(window.localStorage, KEY_B, [{ id: 'b', start: 0, end: 3, note: 'second attempt' }]);
    const { rerender } = layer();
    expect(screen.getByText('first attempt')).toBeTruthy();
    rerender(<AnnotationLayer surface="reading" ownerKey="user-1" attemptKey="att-2"><p>{TEXT}</p></AnnotationLayer>);
    expect(screen.queryByText('first attempt')).toBeNull();
    expect(screen.getByText('second attempt')).toBeTruthy();
  });

  it('locking while the toolbar is open closes it and keeps the saved marks (CR HOLD)', () => {
    writeMarks(window.localStorage, KEY, [{ id: 'a', start: 0, end: 3 }]);
    const { container, rerender } = layer();
    selectText(container, 4, 9);
    const button = screen.getByRole('button', { name: 'Highlight' });
    rerender(<AnnotationLayer surface="reading" ownerKey="user-1" attemptKey="att-1" disabled><p>{TEXT}</p></AnnotationLayer>);
    expect(screen.queryByRole('toolbar')).toBeNull();
    fireEvent.click(button);
    expect(readMarks(window.localStorage, KEY)).toEqual([{ id: 'a', start: 0, end: 3 }]);
  });

  it('locking while a note is being written closes the editor without saving', () => {
    const { container, rerender } = layer();
    selectText(container, 10, 17);
    fireEvent.click(screen.getByRole('button', { name: 'Note' }));
    const box = screen.getByLabelText('Note text');
    const save = screen.getByRole('button', { name: 'Save note' });
    fireEvent.change(box, { target: { value: 'late' } });
    rerender(<AnnotationLayer surface="reading" ownerKey="user-1" attemptKey="att-1" disabled><p>{TEXT}</p></AnnotationLayer>);
    expect(screen.queryByLabelText('Note text')).toBeNull();
    fireEvent.click(save);
    expect(readMarks(window.localStorage, KEY)).toEqual([]);
  });

  it('hydrates without a mismatch when the browser already holds marks (CR P2)', async () => {
    writeMarks(window.localStorage, KEY, [{ id: 'n', start: 4, end: 9, note: 'kept' }]);
    const tree = <AnnotationLayer surface="reading" ownerKey="user-1" attemptKey="att-1" storage={null}><p>{TEXT}</p></AnnotationLayer>;
    const html = renderToString(tree);
    const host = document.createElement('div');
    host.innerHTML = html;
    document.body.appendChild(host);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const recoverable = vi.fn();
    let root: ReturnType<typeof hydrateRoot> | undefined;
    await act(async () => {
      root = hydrateRoot(host, <AnnotationLayer surface="reading" ownerKey="user-1" attemptKey="att-1"><p>{TEXT}</p></AnnotationLayer>, { onRecoverableError: recoverable });
    });
    expect(recoverable).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
    expect(host.textContent).toContain('kept');
    act(() => root!.unmount());
    host.remove();
  });

  it('two layers share the page highlight; removing one keeps the other painted', () => {
    const set = vi.fn();
    const del = vi.fn();
    class FakeHighlight { ranges: Range[]; constructor(...r: Range[]) { this.ranges = r; } }
    vi.stubGlobal('CSS', { highlights: { set, delete: del } });
    vi.stubGlobal('Highlight', FakeHighlight);
    writeMarks(window.localStorage, KEY, [{ id: 'a', start: 4, end: 9 }]);
    const key2 = marksKey('reading', 'user-1', 'att-2');
    writeMarks(window.localStorage, key2, [{ id: 'b', start: 0, end: 3 }]);
    const first = layer();
    const second = render(<AnnotationLayer surface="reading" ownerKey="user-1" attemptKey="att-2"><p>{TEXT}</p></AnnotationLayer>);
    const lastSet = () => (set.mock.calls.at(-1)![1] as FakeHighlight).ranges.map((r) => r.toString()).sort();
    expect(lastSet()).toEqual(['The', 'first']);
    first.unmount();
    expect(lastSet()).toEqual(['The']);
    second.unmount();
    expect(del).toHaveBeenCalledWith('exam-room-mark');
  });

  it('disabled: no toolbar', () => {
    const { container } = layer({ disabled: true });
    selectText(container, 4, 9);
    expect(screen.queryByRole('toolbar')).toBeNull();
  });
});
