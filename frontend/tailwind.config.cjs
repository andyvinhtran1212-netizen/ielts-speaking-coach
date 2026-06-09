/**
 * tailwind.config.cjs — static-build config for the Plus-Jakarta cluster (P0-3
 * C-3.4 build-Tailwind). Replaces the 407KB runtime Play-CDN with a purged,
 * pre-built CSS (css/tailwind.build.css), committed + CI-diff-guarded.
 *
 * Tailwind v3 (Play-CDN was v3 — must match to keep identical class output).
 * No darkMode: the app themes via CSS variables (data-theme + tokens.css), not
 * Tailwind `dark:` utilities (0 in the codebase). Safelist is empty: Phase A
 * found no interpolated Tailwind class names in JS (only IDs/URLs + custom
 * `.is-*` state classes); class strings in markup + js/ renderers are covered by
 * the content globs below.
 */
module.exports = {
  content: [
    './**/*.html',
    './js/**/*.js',
    '!./node_modules/**',
    '!./tests/**',
  ],
  theme: {
    extend: {
      colors: {
        navy: { DEFAULT: '#0C2340', light: '#112d52', dark: '#081829' },
        teal: { DEFAULT: '#0F766E', light: '#14b8a6', dark: '#0d5f58' },
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'ui-sans-serif', 'system-ui'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
    },
  },
  // The JS renderers (grammar.js etc.) emit CUSTOM-color (navy/teal) utilities
  // with non-standard opacity modifiers (bg-teal/12, hover:border-teal/40,
  // text-teal-light/70 …). Tailwind's content scanner drops some of these
  // non-default opacity steps, and safelist *patterns* only match enumerable
  // utilities (so /12 can't be pattern-safelisted). Listing them EXPLICITLY is
  // the only reliable way — and stays minimal (exactly these, no class
  // explosion). Regenerate this list by grepping the renderers if new custom-
  // color classes are added; the CI rebuild-diff guard will catch staleness.
  safelist: [
    // bg-teal/12 (grammar.js:770) is intentionally NOT listed: Tailwind v3 can't
    // generate /12 (not a supported opacity step — verified), so it was a no-op
    // under the Play-CDN too. Behavior is preserved; fixing the class is out of
    // scope (no markup changes). The rest are the renderers' valid custom-color
    // utilities, listed as belt-and-suspenders against content-scan gaps.
    'bg-teal', 'bg-teal/10', 'bg-teal/15', 'bg-teal/[0.06]',
    'border-teal-light', 'border-teal/20', 'border-teal/25', 'border-teal/30',
    'group-hover:text-teal-light',
    'hover:bg-teal-light', 'hover:bg-teal/25', 'hover:bg-teal/[0.07]', 'hover:bg-teal/[0.12]',
    'hover:border-teal/40', 'hover:border-teal/50', 'hover:text-teal-light',
    'text-teal-light', 'text-teal-light/60', 'text-teal-light/70',
  ],
};
