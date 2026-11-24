// UIBASE-0056 icon set (FR-006). Names and drawings are copied from the
// `iconGroups` array of thiet-ke/ThanhPhanNenTang.dc.html; the sheet's
// c(x, y, r) helper is stored as a circle.
//
// PARTIAL on purpose: G03-T05/T06/T10/T13/T14/T16/T18 need only these. G11-T32 replaces this file
// with the full 94-icon set and keeps the same names and the same `Icon` API.
// `fills` are drawn filled with currentColor (the half-filled "device" disc).
export type IconShape = {
  paths: readonly string[];
  circles?: readonly (readonly [number, number, number])[];
  fills?: readonly string[];
};

export const ICON_SET = {
  close: { paths: ['M6 6l12 12M18 6L6 18'] },
  menu: { paths: ['M4 7h16M4 12h16M4 17h16'] },
  'chev-down': { paths: ['M6 9l6 6 6-6'] },
  // Learner shell (G03-T14): the five sections, bell, account and sign-out.
  home: { paths: ['M4 11l8-7 8 7v9H4z'] },
  route: { paths: ['M8 19h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7'], circles: [[6, 19, 2], [18, 5, 2]] },
  timer: { paths: ['M12 9v4l3 2M9 2h6'], circles: [[12, 13, 8]] },
  books: { paths: ['M4 4h5v16H4zM9 4h5v16H9zM15 6l3-1 3 14-3 1z'] },
  bell: { paths: ['M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 21h4'] },
  user: { paths: ['M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1'], circles: [[12, 8, 4]] },
  logout: { paths: ['M9 4H4v16h5M16 8l4 4-4 4M20 12H9'] },
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
  // Audio and video players (G03-T10, HocTap §2–3; NenTang "Phát nghe và ghi âm").
  play: { paths: ['M7 4l13 8-13 8z'] },
  pause: { paths: ['M8 5v14M16 5v14'] },
  'back-10': { paths: ['M3 12a9 9 0 1 0 3-6.7M3 4v5h5'] },
  'fwd-10': { paths: ['M21 12a9 9 0 1 1-3-6.7M21 4v5h-5'] },
  repeat: { paths: ['M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3'] },
  external: { paths: ['M14 4h6v6M20 4l-9 9M18 14v6H4V6h6'] },
  // Theme choice (CheDoToi.dc.html §3): sun = Sáng, moon = Tối, half disc = Theo thiết bị.
  sun: { paths: ['M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4'], circles: [[12, 12, 4]] },
  moon: { paths: ['M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5z'] },
  'theme-device': { paths: [], circles: [[12, 12, 8]], fills: ['M12 4v16a8 8 0 0 0 0-16z'] },
  // Staff shell (G03-T16, KhungTrang2 §7): sidebar collapse and the sample group icons.
  'chev-left': { paths: ['M15 6l-6 6 6 6'] },
  'chev-right': { paths: ['M9 6l6 6-6 6'] },
  users: { paths: ['M2.5 20a6.5 6.5 0 0 1 13 0M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14a6.5 6.5 0 0 1 3.5 6'], circles: [[9, 8, 3.5]] },
  'credit-card': { paths: ['M3 5h18v14H3zM3 10h18M7 15h4'] },
  clipboard: { paths: ['M8 4h8v3H8zM6 5.5V21h12V5.5M9 12h6M9 16h4'] },
  book: { paths: ['M12 6C10 4.5 7 4 3 4v15c4 0 7 .5 9 2 2-1.5 5-2 9-2V4c-4 0-7 .5-9 2zM12 6v15'] },
  chart: { paths: ['M4 4v16h16M8 17v-5M12 17V8M17 17v-3'] },
  settings: { paths: ['M4 6h8M16 6h4M4 12h3M11 12h9M4 18h10M18 18h2'], circles: [[14, 6, 2], [9, 12, 2], [16, 18, 2]] },
} as const satisfies Record<string, IconShape>;

export type IconName = keyof typeof ICON_SET;
