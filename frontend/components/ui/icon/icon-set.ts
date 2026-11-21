// UIBASE-0056 icon set (FR-006). Names and drawings are copied from the
// `iconGroups` array of thiet-ke/ThanhPhanNenTang.dc.html; the sheet's
// c(x, y, r) helper is stored as a circle.
//
// PARTIAL on purpose: G03-T05/T06 need only these. G11-T32 replaces this file
// with the full 94-icon set and keeps the same names and the same `Icon` API.
export type IconShape = { paths: readonly string[]; circles?: readonly (readonly [number, number, number])[] };

export const ICON_SET = {
  close: { paths: ['M6 6l12 12M18 6L6 18'] },
  search: { paths: ['M16.5 16.5L21 21'], circles: [[11, 11, 7]] },
  plus: { paths: ['M12 5v14M5 12h14'] },
  pencil: { paths: ['M4 20l4-1 11-11-3-3L5 16zM14 6l3 3'] },
  trash: { paths: ['M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6'] },
  check: { paths: ['M5 12l5 5 9-10'] },
  'check-circle': { paths: ['M7.5 12.5l3 3 6-7'], circles: [[12, 12, 9]] },
  warning: { paths: ['M12 3L2 20h20zM12 10v4.5M12 17v.5'] },
  error: { paths: ['M12 7.5v5.5M12 16v.5'], circles: [[12, 12, 9]] },
  info: { paths: ['M12 11v5M12 7.5v.5'], circles: [[12, 12, 9]] },
  lock: { paths: ['M5 11h14v9H5zM8 11V8a4 4 0 0 1 8 0v3'] },
  video: { paths: ['M3 5h18v14H3zM10 9v6l5-3z'] },
  image: { paths: ['M3 4h18v16H3zM3 16l5-5 5 5M13 14l3-3 5 5'], circles: [[8, 8, 1.5]] },
} as const satisfies Record<string, IconShape>;

export type IconName = keyof typeof ICON_SET;
