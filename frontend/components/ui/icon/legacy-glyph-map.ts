// G11-T32 (GOI-11 5.7.3): emoji and characters that legacy pages use as icons,
// mapped to the icon of the same meaning in the 94-icon set. Source: the
// "Đang lệch" and "Phạm vi bộ icon" notes of ThanhPhanNenTang §5. Pages that are
// rebuilt on the v2 tree use this when they replace a glyph; legacy pages are
// not changed here (GOI-11 §10 câu 21).
//
// Decorative emoji (fireworks, fire, trophy, waving hand, sprout…) and the old
// home-page mosaic symbols have no icon on purpose: replace them with a text
// label, not with an icon.
import type { SheetIconName } from './icon-set';

// Keys are written as escapes: this file is never rendered, and the
// font-subset test (ui-v2-font-subset-glyphs) reads components/ui as code.
export const LEGACY_GLYPH_MAP: Readonly<Record<string, SheetIconName>> = Object.freeze({
  // Characters used as icons → the Điều hướng group.
  '\u203A': 'chev-right', // ›
  '\u2039': 'chev-left', // ‹
  '\u00D7': 'close', // ×
  '\u2192': 'arrow-right', // →
  '\u2190': 'arrow-left', // ←
  '\u2191': 'arrow-up', // ↑
  '\u2193': 'arrow-down', // ↓
  '\u22EF': 'more', // ⋯
  // Ticks, crosses, warning and the play triangle.
  '\u2713': 'check', // ✓
  '\u2714': 'check', // ✔
  '\u2715': 'close', // ✕
  '\u2717': 'x-circle', // ✗
  '\u26A0': 'warning', // ⚠
  '\u25B6': 'play', // ▶
  // Emoji named on the sheet.
  '\u{1F3A4}': 'mic', // 🎤
  '\u{1F3A7}': 'headphones', // 🎧
  '\u{1F4D6}': 'book', // 📖
  '\u{1F4DA}': 'book', // 📚
  '\u{1F4A1}': 'lightbulb', // 💡
  '\u{1F4CA}': 'chart', // 📊
  '\u{1F6A9}': 'flag', // 🚩
});
