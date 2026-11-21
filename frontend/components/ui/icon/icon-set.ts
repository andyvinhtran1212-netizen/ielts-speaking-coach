// UIBASE-0056 icon set (FR-006). Names and drawings are copied from the
// `iconGroups` array of thiet-ke/ThanhPhanNenTang.dc.html; the sheet's
// c(x, y, r) helper is stored as a circle.
//
// PARTIAL on purpose: G03-T05 needs only these five. G11-T32 replaces this file
// with the full 94-icon set and keeps the same names and the same `Icon` API.
export type IconShape = { paths: readonly string[]; circles?: readonly (readonly [number, number, number])[] };

export const ICON_SET = {
  close: { paths: ['M6 6l12 12M18 6L6 18'] },
  search: { paths: ['M16.5 16.5L21 21'], circles: [[11, 11, 7]] },
  plus: { paths: ['M12 5v14M5 12h14'] },
  pencil: { paths: ['M4 20l4-1 11-11-3-3L5 16zM14 6l3 3'] },
  trash: { paths: ['M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6'] },
} as const satisfies Record<string, IconShape>;

export type IconName = keyof typeof ICON_SET;
