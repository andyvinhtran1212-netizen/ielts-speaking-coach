/**
 * tailwind.config.inter.cjs — Inter-cluster static build (P0-3 C-3.4).
 * The Inter pages (login, d1-exercise, flashcard-study, practice.legacy) are
 * standalone (NOT on the ds.css design system) and render font-sans = Inter via
 * their (old inline) Tailwind config. Reuses the base config (content globs,
 * navy/teal, safelist) and only overrides fontFamily.sans → Inter, so the two
 * builds stay in sync. Output: css/tailwind.inter.css.
 */
const base = require('./tailwind.config.cjs');
module.exports = {
  ...base,
  theme: {
    extend: {
      ...base.theme.extend,
      fontFamily: {
        ...base.theme.extend.fontFamily,
        sans: ['Inter', 'ui-sans-serif', 'system-ui'],
      },
    },
  },
};
