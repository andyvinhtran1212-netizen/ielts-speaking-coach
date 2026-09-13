import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const output = path.join(root, 'public', 'vendor');
const files = {
  'supabase.js': 'node_modules/@supabase/supabase-js/dist/umd/supabase.js',
  'lucide.min.js': 'node_modules/lucide/dist/umd/lucide.min.js',
  'marked.min.js': 'node_modules/marked/marked.min.js',
  'purify.min.js': 'node_modules/dompurify/dist/purify.min.js',
  'chart.umd.min.js': 'node_modules/chart.js/dist/chart.umd.min.js',
};

await mkdir(output, { recursive: true });
await Promise.all(Object.entries(files).map(([name, source]) =>
  copyFile(path.join(root, source), path.join(output, name)),
));
console.log(`[vendor-runtime] copied ${Object.keys(files).length} pinned browser bundles`);
