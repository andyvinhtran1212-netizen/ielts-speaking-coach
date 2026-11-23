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

export const LEGACY_GLYPH_MAP: Readonly<Record<string, SheetIconName>> = Object.freeze({
  // Characters used as icons → the Điều hướng group.
  '›': 'chev-right',
  '‹': 'chev-left',
  '×': 'close',
  '→': 'arrow-right',
  '←': 'arrow-left',
  '↑': 'arrow-up',
  '↓': 'arrow-down',
  '⋯': 'more',
  // Ticks, crosses, warning and the play triangle.
  '✓': 'check',
  '✔': 'check',
  '✕': 'close',
  '✗': 'x-circle',
  '⚠': 'warning',
  '▶': 'play',
  // Emoji named on the sheet.
  '🎤': 'mic',
  '🎧': 'headphones',
  '📖': 'book',
  '📚': 'book',
  '💡': 'lightbulb',
  '📊': 'chart',
  '🚩': 'flag',
});
