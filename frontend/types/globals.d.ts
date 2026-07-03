// Step-A typecheck pilot — ambient globals the page scripts rely on.
// api.js attaches `window.api` + initSupabase/getSupabase; toast.js adds showToast.
// Declaring them here removes the systemic "Property X does not exist on Window"
// (TS2339) noise so a `// @ts-check` file can focus on its real data types.
// (Loose by design for the pilot — tighten alongside a future strict step.)

interface AverApi {
  base: string;
  url(path: string): string;
  get<T = unknown>(path: string): Promise<T>;
  post<T = unknown>(path: string, body?: unknown): Promise<T>;
  patch<T = unknown>(path: string, body?: unknown): Promise<T>;
  delete<T = unknown>(path: string): Promise<T>;
  upload<T = unknown>(path: string, fd: FormData): Promise<T>;
  getWith<T = unknown>(path: string, hdrs?: Record<string, string>, opts?: unknown): Promise<T>;
  postWith<T = unknown>(path: string, body?: unknown, hdrs?: Record<string, string>, opts?: unknown): Promise<T>;
  patchWith<T = unknown>(path: string, body?: unknown, hdrs?: Record<string, string>, opts?: unknown): Promise<T>;
}

// Shared HTML escaper namespace (audit 2026-07-03 C4) — window.WC.escapeHtml is
// defined in api.js and delegated to by page-scripts. Optional because a page may
// run before api.js has attached it (the delegates all carry a local fallback).
interface AverWC {
  // Optional: api.js seeds `window.WC = window.WC || {}` before assigning
  // escapeHtml, so an empty {} must be assignable to AverWC.
  escapeHtml?(s?: unknown): string;
}

interface Window {
  api: AverApi;
  WC?: AverWC;
  supabase: any;
  initSupabase(url: string, anonKey: string): void;
  getSupabase(): unknown;
  showToast(message: string, kind?: string, opts?: unknown): void;
}

declare function showToast(message: string, kind?: string, opts?: unknown): void;
declare function confirmDanger(opts: unknown): Promise<boolean>;
