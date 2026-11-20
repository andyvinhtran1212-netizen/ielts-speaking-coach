import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { collectAssetInventory, sourceLiterals, summarizeAssetEvidence } from '../tooling/gate-f-asset-inventory.mjs';

test('JS comments are not runtime edges; templates preserve conservative families', () => {
  const literals = sourceLiterals('// load /js/comment.js\nconst a="/js/real.js"; const b=`/js/modules/${name}.js`;', 'example.ts');
  assert.deepEqual(literals.map(({text}) => text), ['/js/real.js', '/js/modules/*.js']);
  assert.equal(literals[1].dynamic, true);
});

test('collector exposes parse problems and reads JSX and TypeScript module literals', () => {
  const warnings=[];
  assert.ok(sourceLiterals('const x=<script src="/root.js"/>;', 'file.js', warnings).some(({text})=>text==='/root.js'));
  assert.ok(sourceLiterals('import "/root.js";', 'file.mts', warnings).some(({text})=>text==='/root.js'));
  assert.equal(warnings.length,0);
  sourceLiterals('const = ;', 'broken.js', warnings);
  assert.equal(warnings[0].reason,'parse-diagnostics');
});

test('collector reports self-reference, root assets, dynamic origin and fixture/alias drift truthfully', () => {
  const root=mkdtempSync(path.join(tmpdir(),'aver-asset-edge-cases-'));
  const files={
    'frontend/app/page.jsx': 'const x=<script src="/sw.js"/>;const y=`${cdn}/js/from-base.js`;const z="/vendor/theme.css";const multiline="escaped\\ntext /js/from-base.js";',
    'frontend/public/sw.js':'',
    'frontend/public/vendor/theme.css':'',
    'frontend/public/js/from-base.js':'',
    'frontend/public/js/only-self.js':'',
    'frontend/public/js/fixture.js':'',
    'frontend/tests/gate-f-asset-inventory.test.mjs':'const fake="/js/only-self.js";',
    'frontend/tests/fixtures/gate-e-legacy/manifest.json':JSON.stringify({files:[{file:'html/missing.html',url:'/pages/missing.html'}]}),
    'frontend/tests/fixtures/gate-e-legacy/html/unlisted.html':'<script src="../js/fixture.js"></script>',
  };
  try {
    for(const [name,body] of Object.entries(files)){
      mkdirSync(path.dirname(path.join(root,name)),{recursive:true});writeFileSync(path.join(root,name),body);
    }
    symlinkSync('./public/js',path.join(root,'frontend/js'));
    symlinkSync('public/vendor',path.join(root,'frontend/css'));
    symlinkSync('sw.js',path.join(root,'frontend/public/linked.js'));
    const report=collectAssetInventory(root);
    const row=(url)=>report.assets.find((asset)=>asset.path==='frontend/public/'+url);
    assert.equal(row('js/only-self.js').decision,'hold-unresolved');
    assert.equal(row('sw.js').decision,'retain-next-dependency');
    assert.equal(row('vendor/theme.css').decision,'retain-next-dependency');
    assert.ok(row('js/from-base.js').evidence.some((edge)=>edge.kind==='dynamic-family'));
    assert.ok(report.dynamicFamilies.some((family)=>family.raw.includes('${cdn}')));
    assert.ok(row('js/from-base.js').evidence.every((edge)=>edge.line===1&&edge.lineKind==='literal-start'));
    for(const reason of ['unlisted-html-fixture','missing-html-fixture','public-build-alias-unverified','symlink-not-walked']){
      assert.ok(report.warnings.some((warning)=>warning.reason===reason),reason);
    }
    assert.equal(report.aliasVerification.find(({alias})=>alias==='js').verified,true);
    assert.equal(report.aliasVerification.find(({alias})=>alias==='css').verified,false);
    assert.equal(Object.values(report.summary.dispositions).reduce((sum,n)=>sum+n,0),report.summary.totalAssets);
    const summary=summarizeAssetEvidence(report);
    assert.equal(summary.assets.find((asset)=>asset.path.endsWith('/sw.js')).evidenceCount,row('sw.js').evidence.length);
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('dated audit artifact is internally consistent without freezing future product assets', () => {
  const saved=JSON.parse(readFileSync(new URL('../../docs/audits/GATE_F_ASSET_INVENTORY_2026-09-10.json',import.meta.url),'utf8'));
  const {sourceRelease,auditDate,evidenceFormat,...recorded}=saved;
  assert.equal(sourceRelease,'b44efaa72fe61e4c22a0be704c8a62795691d0b9');
  assert.equal(auditDate,'2026-09-10');
  assert.ok(evidenceFormat);
  assert.equal(recorded.deletionAuthorized,false);
  assert.deepEqual(recorded.approvedForDeletion,[]);
  assert.deepEqual(recorded.warnings,[]);
  assert.ok(recorded.aliasVerification.every(({verified})=>verified));
  assert.equal(recorded.assets.length,recorded.summary.totalAssets);
  assert.equal(new Set(recorded.assets.map(({path})=>path)).size,recorded.assets.length);
  for(const [decision,count] of Object.entries(recorded.summary.dispositions)) {
    assert.equal(recorded.assets.filter((asset)=>asset.decision===decision).length,count);
  }
  for(const asset of recorded.assets) {
    assert.match(asset.sha256,/^[a-f0-9]{64}$/);
    assert.equal(Object.values(asset.evidenceByCategory).reduce((sum,item)=>sum+item.count,0),asset.evidenceCount);
    for(const item of Object.values(asset.evidenceByCategory)) assert.ok(item.examples.length<=item.count);
  }
});

test('asset inventory preserves transitive, dynamic, fixture and unknown dependencies without approving deletion', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'aver-asset-inventory-'));
  const files = {
    'frontend/app/page.tsx': 'import "../public/css/main.css"; const x="/js/start.js?v=1"; const d=`/js/modules/${name}.js`; const spell="/assets/vendor/spell.js"; // /js/comment.js\nconst remote="https://cdn.example/js/remote.js";',
    'frontend/public/assets/vendor/spell.js': '',
    'frontend/public/css/generated.css': '',
    'frontend/package.json': JSON.stringify({scripts:{build:'tool -o ./css/generated.css'}}),
    'frontend/public/js/start.js': 'import "./child.mjs";',
    'frontend/public/js/child.mjs': 'import "./start.js";',
    'frontend/public/js/modules/one.js': '',
    'frontend/public/js/modules/two.js': '',
    'frontend/public/js/comment.js': '',
    'frontend/public/js/remote.js': '',
    'frontend/public/js/unknown.js': '',
    'frontend/public/js/fixture.js': 'import "./helper.js";',
    'frontend/public/js/helper.js': '',
    'frontend/public/js/old-only.js': '',
    'frontend/public/css/main.css': '@import "./child.css";',
    'frontend/public/css/child.css': '',
    'frontend/public/pages/old.html': '<script src="/js/old-only.js"></script>',
    'frontend/tests/fixtures/gate-e-legacy/manifest.json': JSON.stringify({files:[{file:'html/test.html',url:'/pages/test.html'}]}),
    'frontend/tests/fixtures/gate-e-legacy/html/test.html': '<script src="../js/fixture.js"></script>',
  };
  try {
    for (const [name, body] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, name)), {recursive:true});
      writeFileSync(path.join(root, name), body);
    }
    symlinkSync('public/css', path.join(root, 'frontend/css'));
    const inventory = collectAssetInventory(root);
    const row = (name) => inventory.assets.find((asset) => asset.path === 'frontend/public/'+name);
    assert.equal(row('js/start.js').decision, 'retain-next-dependency');
    assert.deepEqual(row('js/child.mjs').nextChain, ['frontend/public/js/start.js','frontend/public/js/child.mjs']);
    assert.equal(row('js/modules/two.js').decision, 'retain-next-dependency');
    assert.ok(row('js/modules/two.js').evidence.some((edge) => edge.kind === 'dynamic-family'));
    assert.equal(row('css/child.css').decision, 'retain-next-dependency');
    assert.equal(row('assets/vendor/spell.js').decision, 'retain-next-dependency');
    assert.equal(row('css/generated.css').decision, 'hold-other-consumer-review');
    assert.equal(row('js/helper.js').decision, 'retain-archived-test-dependency');
    assert.equal(row('js/old-only.js').decision, 'hold-other-consumer-review');
    for (const name of ['comment.js','remote.js','unknown.js']) assert.equal(row('js/'+name).decision, 'hold-unresolved');
    assert.equal(inventory.deletionAuthorized, false);
    assert.deepEqual(inventory.approvedForDeletion, []);
    assert.equal(inventory.assets.length, 14);
    assert.deepEqual(inventory, collectAssetInventory(root));
  } finally { rmSync(root, {recursive:true,force:true}); }
});
