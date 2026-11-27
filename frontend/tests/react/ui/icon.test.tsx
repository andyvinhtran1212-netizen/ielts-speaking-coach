// G11-T32 (GOI-11 5.7.3, FR-11-113) and UIBASE-0056 FR-006: the icon set is
// exactly the 94 icons of ThanhPhanNenTang §5, drawn as on the sheet, and
// components/ui draws no icon of its own.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Icon } from '@/components/ui';
import {
  ICON_GROUPS, ICON_SET, SHEET_ICONS, THEME_ICONS, type IconName, type IconShape,
} from '@/components/ui/icon/icon-set';
import { LEGACY_GLYPH_MAP } from '@/components/ui/icon/legacy-glyph-map';

afterEach(cleanup);

const FRONTEND = join(__dirname, '..', '..', '..');
const SHEET = join(FRONTEND, '..', 'docs', 'proposals', 'commercialization-2026-11', 'thiet-ke',
  'ThanhPhanNenTang.dc.html');

type SheetIcon = { n: string; vi: string; paths: string[]; circles: number[][] };

/** The sheet's own `iconGroups` script, with c(x, y, r) kept as a circle. */
function sheetGroups(): { name: string; count: number; items: SheetIcon[] }[] {
  const html = readFileSync(SHEET, 'utf8');
  const start = html.indexOf('const iconGroups = [');
  const end = html.indexOf('const iconTotal');
  expect(start, 'iconGroups not found on the sheet').toBeGreaterThan(0);
  const source = html.slice(start + 'const iconGroups = '.length, end).trim().replace(/;$/, '');
  const c = (x: number, y: number, r: number) => `§${x},${y},${r}§`;
  const I = (n: string, vi: string, d: string) => {
    const circles: number[][] = [];
    const rest = d.replace(/§([\d.]+),([\d.]+),([\d.]+)§/g, (_m, a, b, r) => {
      circles.push([Number(a), Number(b), Number(r)]);
      return '\n';
    });
    return { n, vi, paths: rest.split('\n').map((s) => s.trim()).filter(Boolean), circles };
  };
  // The sheet is a checked-in design file of this repository, not input.
  return new Function('c', 'I', `return (${source});`)(c, I);
}

describe('icon set (FR-11-113, FR-006)', () => {
  const groups = sheetGroups();
  const sheet = groups.flatMap((g) => g.items);

  it('has exactly the 94 names of the sheet, no duplicates, in the sheet groups', () => {
    expect(sheet).toHaveLength(94);
    expect(Object.keys(SHEET_ICONS)).toEqual(sheet.map((i) => i.n));
    expect(new Set(Object.keys(SHEET_ICONS)).size).toBe(94);
    expect(ICON_GROUPS.map((g) => g.name)).toEqual(groups.map((g) => g.name));
    for (const [i, g] of groups.entries()) {
      expect(g.items, `${g.name}: count`).toHaveLength(g.count);
      expect(ICON_GROUPS[i].icons).toEqual(g.items.map((it) => [it.n, it.vi]));
    }
  });

  it('draws every icon as the sheet does (record: inner dot filled, the one exception)', () => {
    for (const icon of sheet) {
      const shape: IconShape = SHEET_ICONS[icon.n as keyof typeof SHEET_ICONS];
      if (icon.n === 'record') {
        expect(icon.circles).toEqual([[12, 12, 4], [12, 12, 2]]);
        expect(shape.circles).toEqual([[12, 12, 4]]);
        expect(shape.fills).toEqual(['M10 12a2 2 0 1 0 4 0a2 2 0 1 0 -4 0']);
        continue;
      }
      expect(shape.paths, icon.n).toEqual(icon.paths);
      expect(shape.circles ?? [], icon.n).toEqual(icon.circles);
      expect(shape.fills, icon.n).toBeUndefined();
    }
  });

  it('keeps the three theme-choice icons apart from the sheet set', () => {
    expect(Object.keys(THEME_ICONS)).toEqual(['sun', 'moon', 'theme-device']);
    for (const name of Object.keys(THEME_ICONS)) expect(name in SHEET_ICONS).toBe(false);
    expect(Object.keys(ICON_SET)).toHaveLength(97);
  });

  it('renders every name: 24 grid, 2px currentColor stroke, decorative without a title', () => {
    for (const name of Object.keys(ICON_SET) as IconName[]) {
      const { container } = render(<Icon name={name} />);
      const svg = container.querySelector('svg')!;
      expect(svg.getAttribute('viewBox'), name).toBe('0 0 24 24');
      expect(svg.getAttribute('stroke'), name).toBe('currentColor');
      expect(svg.getAttribute('stroke-width'), name).toBe('2');
      expect(svg.getAttribute('fill'), name).toBe('none');
      expect(svg.getAttribute('aria-hidden'), name).toBe('true');
      expect(svg.children.length, name).toBeGreaterThan(0);
      cleanup();
    }
  });

  it('with a title it is an image named by that title', () => {
    render(<Icon name="mic" title="Micro" />);
    const img = screen.getByRole('img', { name: 'Micro' });
    expect(img.getAttribute('aria-hidden')).toBeNull();
    expect(img.querySelector('title')?.textContent).toBe('Micro');
  });

  it('maps legacy glyphs only to sheet icons', () => {
    for (const [glyph, name] of Object.entries(LEGACY_GLYPH_MAP)) {
      expect(name in SHEET_ICONS, `${glyph} → ${name}`).toBe(true);
    }
  });
});

describe('components/ui draws no icon of its own (FR-006)', () => {
  const UI = join(FRONTEND, 'components', 'ui');
  const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(tsx?|css)$/.test(name) ? [path] : [];
  });
  const sources = files(UI)
    .filter((path) => !relative(UI, path).startsWith('icon'))
    .map((path) => ({ path: relative(UI, path), text: readFileSync(path, 'utf8') }));

  it('no emoji (the ©, ® and ™ signs are text, not emoji)', () => {
    const emoji = /(?![©®™])\p{Extended_Pictographic}/u;
    expect(sources.filter((s) => emoji.test(s.text)).map((s) => s.path)).toEqual([]);
  });

  // G03-T08 (merged before this set) draws its own small SVGs: chart legend
  // swatches, the stat-card trend arrow, file/upload, calendar/clock, sort and
  // chip-close marks. They are known exceptions until they move to <Icon>; the
  // count is pinned so no new hand-written <svg> can join them.
  const KNOWN_SVG: Record<string, number> = {
    'chart.tsx': 3, 'data-table.tsx': 2, 'date-fields.tsx': 4, 'file-upload.tsx': 2, 'stat-card.tsx': 1,
  };

  it('no lucide and no hand-written <svg> outside components/ui/icon (G03-T08 exceptions pinned)', () => {
    expect(sources.filter((s) => /lucide/i.test(s.text)).map((s) => s.path)).toEqual([]);
    const svgs = Object.fromEntries(sources
      .map((s) => [s.path, (s.text.match(/<svg[\s>]/g) ?? []).length] as const)
      .filter(([, n]) => n > 0));
    expect(svgs).toEqual(KNOWN_SVG);
  });
});
