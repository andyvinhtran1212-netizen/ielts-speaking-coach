import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GrammarModeSwitcher } from '@/app/(public-content)/grammar/grammar-home-mode';

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Grammar mode switcher', () => {
  it('uses the roving-tab keyboard contract and exposes the selected panel', () => {
    render(<GrammarModeSwitcher reference={<p>Tra cứu content</p>} learning={<p>Lộ trình content</p>} />);

    const reference = screen.getByRole('tab', { name: /Tra cứu/ });
    const learning = screen.getByRole('tab', { name: /Học & luyện/ });
    const referencePanel = screen.getByRole('tabpanel', { name: /Tra cứu/ });

    expect(reference.getAttribute('aria-selected')).toBe('true');
    expect(referencePanel.hidden).toBe(false);
    expect(screen.queryByRole('tabpanel', { name: /Học & luyện/ })).toBeNull();

    fireEvent.keyDown(reference, { key: 'ArrowRight' });

    expect(learning.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(learning);
    expect(screen.getByRole('tabpanel', { name: /Học & luyện/ }).hidden).toBe(false);
    expect(screen.queryByRole('tabpanel', { name: /Tra cứu/ })).toBeNull();

    fireEvent.keyDown(learning, { key: 'Home' });
    expect(reference.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(reference);
  });
});
