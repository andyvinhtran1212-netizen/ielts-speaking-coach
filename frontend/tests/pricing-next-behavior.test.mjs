import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const FRONTEND = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGE_PATH = path.join(FRONTEND, 'app', '(marketing)', 'pricing', 'page.tsx');
const PAGE = readFileSync(PAGE_PATH, 'utf8');
const NEXT_LANDING = readFileSync(path.join(FRONTEND, 'app', '(marketing)', 'page.tsx'), 'utf8');
const LEDGER = readFileSync(path.join(FRONTEND, '../docs/ROUTE_LEDGER.md'), 'utf8');
const WORKFLOW = readFileSync(path.join(FRONTEND, '../.github/workflows/next-native-browser.yml'), 'utf8');
const VERIFY_PRICING = path.join(FRONTEND, 'tooling', 'verify-pricing-redirect-flow.mjs');
const execFileAsync = promisify(execFile);

const listen = (server) => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    resolve(`http://127.0.0.1:${address.port}`);
  });
});

const close = (server) => new Promise((resolve) => server.close(resolve));

describe('/pricing pre-launch native ownership', () => {
  test('Next owns the clean route with a server redirect only', () => {
    assert.ok(existsSync(PAGE_PATH));
    assert.match(PAGE, /import \{ redirect \} from 'next\/navigation'/);
    assert.match(PAGE, /redirect\('\/'\)/);
    assert.doesNotMatch(PAGE, /use client|useEffect|window\.location/);
  });

  test('executing the actual Next page throws a temporary homepage redirect, not content', () => {
    const compiled = ts.transpileModule(PAGE, {
      fileName: PAGE_PATH,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    });
    const nativeRequire = createRequire(import.meta.url);
    const exports = {};
    runInNewContext(compiled.outputText, { exports, require(name) {
      assert.equal(name, 'next/navigation');
      return nativeRequire(name);
    } });
    assert.throws(() => exports.default(), (error) => {
      assert.equal(error.digest, 'NEXT_REDIRECT;replace;/;307;');
      return true;
    });
  });

  test('native landing enters the clean canonical route', () => {
    assert.match(NEXT_LANDING, /href="\/pricing"/);
    assert.doesNotMatch(NEXT_LANDING, /href="\/pricing\.html"/);
  });

  test('ledger records closed-state behavior and rollback boundary', () => {
    assert.match(LEDGER, /`\/pricing`[^\n]+app\/\(marketing\)\/pricing\/page\.tsx[^\n]+CUTOVER 2026-08-15/);
    assert.match(LEDGER, /`\/pricing`[^\n]+server redirect về `\/`[^\n]+Legacy[^\n]+redirect sentinel/);
  });

  test('CI verifies redirect semantics instead of fake same-page parity', () => {
    assert.match(WORKFLOW, /frontend\/app\/\(marketing\)\/pricing\/\*\*/);
    assert.match(WORKFLOW, /node tooling\/verify-pricing-redirect-flow\.mjs/);
  });

  test('redirect verifier rejects a cross-origin homepage target', async () => {
    const target = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<h1>External homepage</h1>');
    });
    const targetBase = await listen(target);
    const source = createServer((_request, response) => {
      response.writeHead(307, { location: `${targetBase}/` });
      response.end();
    });
    const sourceBase = await listen(source);

    try {
      await assert.rejects(
        execFileAsync(process.execPath, [VERIFY_PRICING, sourceBase]),
        (error) => {
          assert.equal(error.code, 1);
          assert.match(error.stdout, /redirect target is exactly the same-origin homepage/);
          assert.match(error.stdout, /normal navigation finishes on the same-origin homepage/);
          return true;
        },
      );
    } finally {
      await close(source);
      await close(target);
    }
  });
});
