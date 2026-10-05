import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GrammarModeSwitcher } from '@/app/(public-content)/grammar/grammar-home-mode';

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(window.location.search) }));

beforeEach(() => {
  window.history.replaceState(null, '', '/grammar');
});

afterEach(() => {
  cleanup();
});

describe('Grammar mode switcher', () => {
  it('uses the roving-tab keyboard contract and exposes the selected panel', () => {
    const view = () => <GrammarModeSwitcher reference={<p>Tra cứu content</p>} learning={<p>Lộ trình content</p>} />;
    const { rerender } = render(view());

    const reference = screen.getByRole('tab', { name: /Tra cứu/ });
    const learning = screen.getByRole('tab', { name: /Học & luyện/ });
    const referencePanel = screen.getByRole('tabpanel', { name: /Tra cứu/ });

    expect(reference.getAttribute('aria-selected')).toBe('true');
    expect(referencePanel.hidden).toBe(false);
    expect(screen.queryByRole('tabpanel', { name: /Học & luyện/ })).toBeNull();

    fireEvent.keyDown(reference, { key: 'ArrowRight' });
    expect(window.location.search).toBe('?mode=learning');
    expect(document.activeElement).toBe(learning);
    // Next updates its useSearchParams subscription after native replaceState;
    // this unit hook reads the URL on render. The native journey covers that subscription.
    rerender(view());

    expect(learning.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(learning);
    expect(screen.getByRole('tabpanel', { name: /Học & luyện/ }).hidden).toBe(false);
    expect(screen.queryByRole('tabpanel', { name: /Tra cứu/ })).toBeNull();

    fireEvent.keyDown(learning, { key: 'Home' });
    expect(window.location.search).toBe('');
    rerender(view());
    expect(reference.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(reference);
  });

  it('honors a learning deep link and safely falls back on duplicate mode', () => {
    window.history.replaceState(null, '', '/grammar?mode=learning');
    const view = () => <GrammarModeSwitcher reference={<p>Tra cứu content</p>} learning={<p>Lộ trình content</p>} />;
    const { rerender } = render(view());
    expect(screen.getByRole('tab', { name: /Học & luyện/ }).getAttribute('aria-selected')).toBe('true');
    window.history.replaceState(null, '', '/grammar?mode=learning&mode=reference');
    rerender(view());
    expect(screen.getByRole('tab', { name: /Tra cứu/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByRole('tabpanel', { name: /Học & luyện/ })).toBeNull();
  });
});
