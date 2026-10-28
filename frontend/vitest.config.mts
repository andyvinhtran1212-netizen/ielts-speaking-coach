import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const frontendRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  // Next serves public/; Vite's own publicDir guard would refuse the browser
  // modules there that the app imports as source.
  publicDir: false,
  resolve: {
    alias: [
      { find: '@', replacement: frontendRoot },
      // Public browser modules (e.g. <aver-chrome>) import their siblings by
      // their deployed URL, /js/<file>.
      { find: /^\/js\//, replacement: `${frontendRoot}public/js/` },
    ],
  },
  test: {
    environment: 'jsdom',
    include: ['tests/react/**/*.test.tsx'],
    restoreMocks: true,
  },
});
