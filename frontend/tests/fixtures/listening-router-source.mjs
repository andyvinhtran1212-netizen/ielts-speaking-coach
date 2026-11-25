// Shared source reader for `backend/routers/listening/` (BACKENDSPLIT-0076).
//
// `routers.listening` is a package split into submodules. Frontend contract
// tests that assert on backend source must read the whole package, not one
// file, so a block moving between submodules cannot hide the code they check.
// Files are read in sorted name order and joined with "\n".
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const LISTENING_ROUTER_DIR = join(
  dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'backend', 'routers', 'listening',
);

export function readListeningRouterSource() {
  return readdirSync(LISTENING_ROUTER_DIR).filter((name) => name.endsWith('.py')).sort()
    .map((name) => readFileSync(join(LISTENING_ROUTER_DIR, name), 'utf8')).join('\n');
}
