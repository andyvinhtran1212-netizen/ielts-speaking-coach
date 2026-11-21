/**
 * frontend/styles/av2/fonts.ts — the two "Bản in" font families (UIBASE-0056, G03-T02).
 *
 * Only layouts of the new UI tree import this file and put `av2FontClass` on
 * the `.av2-root` element (not on <html>), so legacy pages never download these
 * fonts (FR-004). app/layout.tsx stays untouched.
 *
 * `latin-ext` carries the IPA block (U+0250–02AF); `vietnamese` carries the
 * stacked diacritics. Checked against Next's bundled font-data.json: both
 * families list latin, latin-ext and vietnamese; Source Serif 4 also has an
 * `opsz` axis, which static weights 400/600 do not need.
 *
 * Components must NEVER import this file: next/font does not run under
 * vitest/jsdom.
 */
import { Source_Sans_3, Source_Serif_4 } from 'next/font/google';

export const av2Serif = Source_Serif_4({
  subsets: ['latin', 'latin-ext', 'vietnamese'],
  weight: ['400', '600'],
  display: 'swap',
  variable: '--av2-ff-serif',
});

export const av2Sans = Source_Sans_3({
  subsets: ['latin', 'latin-ext', 'vietnamese'],
  weight: ['400', '600'],
  display: 'swap',
  variable: '--av2-ff-sans',
});

export const av2FontClass = `${av2Serif.variable} ${av2Sans.variable}`;
