import 'server-only';

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { extractLegacyPracticeBody } from '@/lib/legacy-practice-shell.mjs';

// Transitional SSR shell. The source is trusted repository HTML, extracted at
// build time; scripts are rejected by the extractor and loaded explicitly by
// the route-group layout. This keeps one markup truth during the dark-route
// phase without pretending the 3,848-line state machine is already native.
export function LegacyPracticeShell() {
  const source = readFileSync(
    path.join(process.cwd(), 'public', 'pages', 'practice.html'),
    'utf8',
  );
  const markup = extractLegacyPracticeBody(source);
  // `display: contents` keeps the legacy body's direct flex children in the
  // same visual formatting context; the wrapper exists only because React
  // requires one owner for dangerouslySetInnerHTML.
  return (
    <div
      data-practice-shell-bridge=""
      style={{ display: 'contents' }}
      dangerouslySetInnerHTML={{ __html: markup }}
      suppressHydrationWarning
    />
  );
}
