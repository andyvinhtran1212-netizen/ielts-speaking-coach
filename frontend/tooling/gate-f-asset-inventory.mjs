// Conservative, read-only retirement inventory. A missing edge is never deletion approval.
import { readFileSync, readdirSync, existsSync, lstatSync, readlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ASSET = /\.(?:m?js|css)$/;
const CODE = /\.(?:tsx?|jsx?|mjs|cjs|mts|cts)$/;
const SOURCE = /\.(?:tsx?|jsx?|mjs|cjs|mts|cts|css|html|json|ya?ml|py|sh)$/;
const SKIP = new Set(['node_modules', '.next', '.git', '.vercel', 'venv', '__pycache__', 'test-results', 'playwright-report']);
const sha256 = (body) => createHash('sha256').update(body).digest('hex');

function walk(root, relative, warnings = []) {
  if (!existsSync(path.join(root, relative))) return [];
  return readdirSync(path.join(root, relative), { withFileTypes: true }).flatMap((entry) => {
    const name = path.posix.join(relative, entry.name);
    if (SKIP.has(entry.name) || entry.name.startsWith('.env')) return [];
    if (entry.isSymbolicLink()) {
      warnings.push({source:name, reason:'symlink-not-walked'});
      return [];
    }
    return entry.isDirectory() ? walk(root, name, warnings) : [name];
  }).sort();
}

// Parse JS/TS literals instead of matching comments. Embedded HTML strings are retained.
// Template expressions become conservative wildcard families, not claimed exact loads.
export function sourceLiterals(source, filename, warnings = []) {
  if (!CODE.test(filename)) return [{ text: source, offset: 0, dynamic: false, rawText: true }];
  const kind = filename.endsWith('.tsx') ? ts.ScriptKind.TSX
    : /\.(?:ts|mts|cts)$/.test(filename) ? ts.ScriptKind.TS : ts.ScriptKind.JSX;
  const parsed = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true,
    kind);
  if (parsed.parseDiagnostics.length) warnings.push({source:filename, reason:'parse-diagnostics',
    diagnostics:parsed.parseDiagnostics.map(({code,start})=>({code,start}))});
  const literals = [];
  function visit(node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      literals.push({ text: node.text, offset: node.getStart(parsed), dynamic: false });
    } else if (ts.isTemplateExpression(node)) {
      literals.push({ text: node.head.text + node.templateSpans.map((span) => '*'+span.literal.text).join(''),
        offset: node.getStart(parsed), dynamic: true, raw:node.getText(parsed) });
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  return literals;
}

function localAssetUrl(value, sourceUrl) {
  const clean = value.split(/[?#]/)[0];
  if (/^(?:https?:|data:|blob:|\/\/)/.test(clean)) return null;
  if (clean.startsWith('/')) return clean;
  if (clean.startsWith('frontend/public/')) return '/'+clean.slice('frontend/public/'.length);
  if (sourceUrl && /^\.{1,2}\//.test(clean)) return path.posix.normalize(path.posix.join(path.posix.dirname(sourceUrl), clean));
  return null;
}

export function collectAssetInventory(root = ROOT) {
  const warnings = [];
  const assetPaths = walk(root, 'frontend/public', warnings).filter((name) => ASSET.test(name));
  const assets = new Map(assetPaths.map((name) => ['/'+name.slice('frontend/public/'.length), name]));
  const evidence = new Map(assetPaths.map((name) => [name, []]));
  const edges = new Map(assetPaths.map((name) => [name, new Set()]));
  const runtimeRoots = new Set(), fixtureRoots = new Set();
  const aliasVerification = ['js', 'css'].map((name) => {
    const alias = path.join(root, 'frontend', name);
    const symlink = existsSync(alias) && lstatSync(alias).isSymbolicLink();
    const verified = !!symlink && path.resolve(path.dirname(alias), readlinkSync(alias)) === path.join(root, 'frontend/public', name);
    if (!verified) warnings.push({source:'frontend/'+name, reason:'public-build-alias-unverified'});
    return {alias:name, verified};
  });
  const verifiedAliases = aliasVerification.filter(({verified})=>verified).map(({alias})=>alias);
  const unresolvedDynamic = [];
  const snapshotUrls = new Map();
  const fixtureManifest = path.join(root, 'frontend/tests/fixtures/gate-e-legacy/manifest.json');
  if (existsSync(fixtureManifest)) {
    for (const entry of JSON.parse(readFileSync(fixtureManifest, 'utf8')).files) {
      snapshotUrls.set('frontend/tests/fixtures/gate-e-legacy/'+entry.file, entry.url);
    }
  }
  const fixtureFiles = walk(root, 'frontend/tests/fixtures/gate-e-legacy', warnings).filter((name)=>name.endsWith('.html'));
  for (const file of fixtureFiles) if (!snapshotUrls.has(file)) warnings.push({source:file,reason:'unlisted-html-fixture'});
  for (const file of snapshotUrls.keys()) if (!fixtureFiles.includes(file)) warnings.push({source:file,reason:'missing-html-fixture'});
  const sources = [...new Set(['frontend/app', 'frontend/components', 'frontend/lib', 'frontend/public',
    'frontend/tests', 'frontend/tooling', '.github/workflows', 'backend/scripts', 'scripts'].flatMap((dir) => walk(root, dir, warnings)))
    .values()].filter((name) => SOURCE.test(name) && !name.endsWith('package-lock.json')
      && !/(?:^|\/)gate-f-asset-inventory(?:\.test)?\.mjs$/.test(name));
  for (const file of readdirSync(path.join(root, 'frontend'), {withFileTypes:true})) {
    if (file.isFile() && SOURCE.test(file.name) && !file.name.startsWith('.env') && file.name !== 'package-lock.json') {
      sources.push('frontend/'+file.name);
    }
  }
  for (const sourcePath of sources.sort()) {
    const body = readFileSync(path.join(root, sourcePath), 'utf8');
    const runtime = /^frontend\/(?:app|components|lib)\//.test(sourcePath);
    const fixture = snapshotUrls.has(sourcePath);
    const publicSource = sourcePath.startsWith('frontend/public/');
    const sourceUrl = publicSource ? '/'+sourcePath.slice('frontend/public/'.length)
      : snapshotUrls.get(sourcePath);
    const category = runtime ? 'next-source' : fixture ? 'archived-html' : publicSource
      ? (ASSET.test(sourcePath) ? 'public-asset' : 'public-html') : 'test-or-build';
    for (const literal of sourceLiterals(body, sourcePath, warnings)) {
      // Includes quoted URLs inside HTML/CSS, imports, and source file references in tooling.
      const tokens = literal.text.matchAll(/(?<![\w/:.@-])(?:frontend\/(?:public\/)?|\/(?!\/)|\.{1,2}\/|(?:js|css)\/)[^\s'"<>`);,]+\.(?:m?js|css)(?:[?#][^\s'"<>`);,]*)?/g);
      for (const occurrence of tokens) {
        const token = occurrence[0];
        let url = localAssetUrl(token, sourceUrl);
        if (!url && category === 'test-or-build') {
          const aliasPath = token.replace(/^(?:frontend\/|\.\/)/, '').split(/[?#]/)[0];
          if (verifiedAliases.some((alias) => aliasPath.startsWith(alias+'/'))) url = '/'+aliasPath;
        }
        // Next's relative public CSS imports are resolved as source-file imports.
        if (!url && runtime && token.startsWith('.')) {
          const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), token.split(/[?#]/)[0]));
          if (resolved.startsWith('frontend/public/')) url = '/'+resolved.slice('frontend/public/'.length);
        }
        if (!url) continue;
        const wildcard = url.includes('*') || literal.dynamic;
        const pattern = wildcard ? new RegExp('^'+url.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')+'$') : null;
        const matches = wildcard ? [...assets.keys()].filter((candidate) => pattern.test(candidate)) : assets.has(url) ? [url] : [];
        const line = body.slice(0, literal.offset + (literal.rawText ? occurrence.index : 0)).split('\n').length;
        if (wildcard) unresolvedDynamic.push({ source: sourcePath, line, expression: token, matchedAssets: matches.length,
          raw:literal.raw || token,
          disposition: 'conservative-family; verify caller values before narrowing' });
        for (const match of matches) {
          const target = assets.get(match);
          if (target === sourcePath) continue;
          const buildReference = category === 'test-or-build' && !sourcePath.startsWith('frontend/tests/');
          evidence.get(target).push({ source: sourcePath, line, lineKind:literal.rawText ? 'exact' : 'literal-start', category,
            kind: wildcard ? 'dynamic-family' : buildReference ? 'build-reference' : 'literal', reference: token });
          if (runtime) runtimeRoots.add(target);
          if (fixture) fixtureRoots.add(target);
          if (edges.has(sourcePath)) edges.get(sourcePath).add(target);
        }
      }
    }
  }
  function closure(roots) {
    const result = new Map([...roots].map((name) => [name, [name]]));
    const pending = [...roots];
    for (let i = 0; i < pending.length; i++) {
      for (const next of edges.get(pending[i]) || []) {
        if (!result.has(next)) { result.set(next, [...result.get(pending[i]), next]); pending.push(next); }
      }
    }
    return result;
  }
  const runtime = closure(runtimeRoots), fixtures = closure(fixtureRoots);
  const rows = assetPaths.map((name) => {
    const unique = [...new Map(evidence.get(name).map((item) => [JSON.stringify(item), item])).values()];
    const decision = runtime.has(name) ? 'retain-next-dependency' : fixtures.has(name)
      ? 'retain-archived-test-dependency' : unique.length ? 'hold-other-consumer-review' : 'hold-unresolved';
    return { path: name, sha256: sha256(readFileSync(path.join(root, name))), decision,
      nextChain: runtime.get(name) || null, fixtureChain: fixtures.get(name) || null, evidence: unique };
  });
  return { schemaVersion: 1, deletionAuthorized: false, approvedForDeletion: [],
    scope: 'All public JS/MJS/CSS. Conservative source reachability, not runtime execution or deletion proof.',
    limitations: ['Unrecognized computed URLs/concatenation and runtime-generated content need semantic/network review.',
      'HTML/CSS and test/build text may include comments; their references conservatively hold, never approve deletion.',
      'Relative asset URLs within public scripts are conservative source-relative candidates; browser/document semantics require review.',
      'Next roots may include unused modules, while unresolved computed URLs can hide real edges; neither execution completeness nor orphanhood is proved.',
      'Build references may be inputs or generated outputs, not runtime consumers.',
      'Hold evidence may originate from an unreachable asset; interpolated origins may conservatively retain a local asset that is actually loaded remotely.',
      'Scope is case-sensitive .js/.mjs/.css only; other extensions and uppercase suffixes are not inventoried.',
      'Relative test/build paths, bare HTML paths and unlisted-fixture paths are not comprehensively resolved.',
      'Fixture presence drift is warned; malformed JSON or schema may abort rather than emit a report. Invalid scan roots also fail closed.',
      'Build aliases verify immediate symlink targets only; chained aliases and frontend-root symlinked source files need separate review.'],
    summary: { totalAssets: rows.length, nextReachable: runtime.size, archivedFixtureReachable: fixtures.size,
      dispositions: Object.fromEntries(['retain-next-dependency','retain-archived-test-dependency','hold-other-consumer-review','hold-unresolved'].map((key) => [key, rows.filter((row) => row.decision === key).length])) },
    warnings:[...new Map(warnings.map((item)=>[JSON.stringify(item),item])).values()], aliasVerification,
    dynamicFamilies: unresolvedDynamic, assets: rows };
}

export function summarizeAssetEvidence(report) {
  return {...report, assets:report.assets.map(({evidence,...row})=>({...row,evidenceCount:evidence.length,
    evidenceByCategory:Object.fromEntries([...new Set(evidence.map((edge)=>edge.category))].map((category)=>{
      const matches=evidence.filter((edge)=>edge.category===category);
      return [category,{count:matches.length,examples:matches.slice(0,1)}];
    }))}))};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report=collectAssetInventory();
  console.log(JSON.stringify(process.argv.includes('--summary') ? summarizeAssetEvidence(report) : report, null, 2));
}
