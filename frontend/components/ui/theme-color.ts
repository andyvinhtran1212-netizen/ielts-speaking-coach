/**
 * Status-bar colour of the "Bản in" tree (UIBASE-0056 FR-026): the page
 * background `--av2-paper` of each mode. CSS variables cannot be read by
 * <meta name="theme-color">, so the two values are repeated here;
 * tests/av2-theme-color.test.mjs checks they equal styles/av2/tokens.css.
 */
import type { Viewport } from 'next';

export const AV2_THEME_COLOR = Object.freeze({ light: '#FAF6EF', dark: '#1C1A16' } as const);

/** `viewport.themeColor` for a v2 page or shell: one meta per OS mode. */
export const AV2_VIEWPORT: Viewport = Object.freeze({
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: AV2_THEME_COLOR.light },
    { media: '(prefers-color-scheme: dark)', color: AV2_THEME_COLOR.dark },
  ],
});

/**
 * After a choice, point both metas at the chosen mode ("cập nhật theo lựa
 * chọn"); "Theo thiết bị" restores one colour per media query.
 */
export function syncThemeColor(choice: 'light' | 'dark' | 'system'): void {
  if (typeof document === 'undefined') return;
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const own = /dark/.test(meta.getAttribute('media') ?? '') ? 'dark' : 'light';
    meta.content = AV2_THEME_COLOR[choice === 'system' ? own : choice];
  }
}
