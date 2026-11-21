/**
 * Anti-flash theme script for v2 pages and shells (UIBASE-0056 FR-020,
 * DESIGN_SYSTEM §13). The same IIFE as AuthedShell and the public layouts:
 * stored `av-theme` → `prefers-color-scheme` → light, set on <html> before
 * the page paints. Render it first, before the page content.
 */
export const THEME_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem('av-theme');
    var prefersDark = window.matchMedia &&
                      window.matchMedia('(prefers-color-scheme: dark)').matches;
    var theme = (stored === 'light' || stored === 'dark')
                ? stored
                : (prefersDark ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();
`.trim();

/** `nonce`: pass the request nonce where the CSP nonce policy applies (AuthedShell pattern). */
export function ThemeScript({ nonce }: { nonce?: string }) {
  return <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} suppressHydrationWarning />;
}
