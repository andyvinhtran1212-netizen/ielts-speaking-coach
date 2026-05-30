/**
 * frontend/tests/sprint-20-14f-alpha-diagram-image.test.mjs
 *
 * Sprint 20.14f-α — diagram / flow-chart image upload path. Static-
 * analysis sentinels covering the renderer, the back-compat fallback,
 * the restoreAnswers extension, and the admin upload UI wiring.
 *
 *   α.5 Renderer  — `_renderDiagramImageBlock` exists; renderQuestions
 *                   short-circuits the mono-block path when a diagram/
 *                   flow run carries `payload.image_url` on its first Q
 *   α.5 restore   — `.exam-diagram-container [name="q-N"]` joins the
 *                   restoreAnswers out-of-card lookup
 *   α.4 Admin UI  — diagram-manager test_id input + per-Q card scaffold
 *                   + upload/delete handlers + api wiring
 *   α.6 CSS       — `.exam-diagram-container`, `.exam-diagram-image`,
 *                   `.exam-diagram-row`, `.exam-diagram-row__num`,
 *                   `.exam-diagram-row__input` ship
 *   α.8 Spec docs — v2 spec §4.2 has the Sprint 20.14f-α sub-section
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');
const read = (rel) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');


// ── α.5 Renderer dispatch + helper ────────────────────────────────────

describe('Sprint 20.14f-α — diagram image renderer dispatch', () => {
  const js = read('frontend/js/reading-exam.js');

  test('renderQuestions detects payload.image_url on diagram/flow run and short-circuits', () => {
    assert.match(
      js,
      /type\s*===\s*['"]diagram_label_completion['"][\s\S]{0,200}type\s*===\s*['"]flow_chart_completion['"][\s\S]{0,400}run\[0\]\.payload\.image_url[\s\S]{0,400}_renderDiagramImageBlock\(run\)/,
    );
    // Early-return so the mono-block path doesn't ALSO fire.
    assert.match(
      js,
      /_renderDiagramImageBlock\(run\)[\s\S]{0,200}return;\s*\/\/\s*skip the mono-block path/,
    );
  });

  test('_renderDiagramImageBlock helper exists', () => {
    assert.match(js, /function\s+_renderDiagramImageBlock\s*\(\s*run\s*\)/);
  });

  test('renderer emits .exam-diagram-container with <img src=imageUrl>', () => {
    assert.match(
      js,
      /_renderDiagramImageBlock[\s\S]{0,400}className\s*=\s*['"]exam-diagram-container['"]/,
    );
    assert.match(
      js,
      /_renderDiagramImageBlock[\s\S]{0,800}img\.className\s*=\s*['"]exam-diagram-image['"][\s\S]{0,80}img\.src\s*=\s*imgUrl/,
    );
  });

  test('each row carries .exam-diagram-row__num + __prompt + __input with name="q-N"', () => {
    assert.match(js, /exam-diagram-row__num/);
    assert.match(js, /exam-diagram-row__prompt/);
    assert.match(js, /exam-diagram-row__input/);
    assert.match(
      js,
      /_renderDiagramImageBlock[\s\S]{0,2000}input\.name\s*=\s*['"]q-['"]\s*\+\s*q\.q_num/,
    );
  });

  test('container delegates change/input to _summaryGapChanged (shared per-gap handler)', () => {
    // Per-gap handler is shared with the 20.14e summary flowing block
    // — same SESSION.answers + palette flip + debounce semantics.
    assert.match(
      js,
      /_renderDiagramImageBlock[\s\S]{0,3000}container\.addEventListener\(['"]input['"][\s\S]{0,400}_summaryGapChanged/,
    );
    assert.match(
      js,
      /_renderDiagramImageBlock[\s\S]{0,3500}container\.addEventListener\(['"]change['"][\s\S]{0,400}_summaryGapChanged/,
    );
  });
});


// ── α.5 restoreAnswers extension ──────────────────────────────────────

describe('Sprint 20.14f-α — restoreAnswers joins .exam-diagram-container lookup', () => {
  const js = read('frontend/js/reading-exam.js');

  test('restoreAnswers selector covers BOTH summary and diagram out-of-card inputs', () => {
    assert.match(
      js,
      /\.exam-gap-box--summary\s+\[name="q-['"]\s*\+\s*qNum[\s\S]{0,200}\.exam-diagram-container\s+\[name="q-['"]\s*\+\s*qNum/,
    );
  });
});


// ── α.6 CSS contract ─────────────────────────────────────────────────

describe('Sprint 20.14f-α — diagram CSS ships', () => {
  const css = read('frontend/css/reading-exam.css');

  test('.exam-diagram-container is a flex column inside the chrome scope', () => {
    assert.match(
      css,
      /\.exam-chrome\s+\.exam-diagram-container\s*\{[\s\S]{0,400}display:\s*flex[\s\S]{0,200}flex-direction:\s*column/,
    );
  });

  test('.exam-diagram-image is capped at 65vh + object-fit: contain', () => {
    assert.match(
      css,
      /\.exam-chrome\s+\.exam-diagram-image\s*\{[\s\S]{0,800}max-height:\s*65vh/,
    );
    assert.match(
      css,
      /\.exam-chrome\s+\.exam-diagram-image\s*\{[\s\S]{0,800}object-fit:\s*contain/,
    );
  });

  test('.exam-diagram-row uses the 28px badge / 1fr / 200px grid', () => {
    assert.match(
      css,
      /\.exam-chrome\s+\.exam-diagram-row\s*\{[\s\S]{0,400}grid-template-columns:\s*28px\s+1fr\s+200px/,
    );
  });

  test('.exam-diagram-row__num is a filled navy circle (matches .exam-q__num)', () => {
    // Two declarations inside the block; order is incidental. Two
    // separate asserts keep the failure message precise.
    const ruleMatch = css.match(/\.exam-chrome\s+\.exam-diagram-row__num\s*\{([\s\S]*?)\}/);
    assert.ok(ruleMatch, 'rule not found');
    const body = ruleMatch[1];
    assert.match(body, /background:\s*var\(--ielts-navy\)/);
    assert.match(body, /border-radius:\s*50%/);
  });

  test('Mobile: row collapses to two-line stack at ≤600px', () => {
    assert.match(
      css,
      /@media\s*\(\s*max-width:\s*600px\s*\)\s*\{[\s\S]{0,500}\.exam-diagram-row[\s\S]{0,200}grid-template-columns:\s*28px\s+1fr/,
    );
  });
});


// ── α.4 Admin UI scaffold ────────────────────────────────────────────

// reading-admin-preview-fix: the standalone "type a test_id" diagram manager
// moved OFF /admin/reading/content INTO the per-test preview page, where each
// diagram/flow question shows its upload/delete controls inline (and the admin
// preview endpoint works on draft tests too, unlike the old student-endpoint
// manager). These assertions now target the preview page.
describe('Sprint 20.14f-α — diagram manager (folded into per-test preview)', () => {
  const contentHtml = read('frontend/pages/admin/reading/content.html');
  const previewJs = read('frontend/js/admin-reading-preview.js');
  const adminCss = read('frontend/css/admin-reading.css');

  test('standalone diagram-manager toolbar removed from content.html', () => {
    assert.doesNotMatch(contentHtml, /id="ar-diagram-test-id"/);
    assert.doesNotMatch(contentHtml, /id="ar-diagram-load"/);
  });

  test('preview JS gates controls to diagram_label + flow_chart question_types', () => {
    assert.match(
      previewJs,
      /DIAGRAM_TYPES\s*=\s*\{[\s\S]{0,120}diagram_label_completion[\s\S]{0,80}flow_chart_completion/,
    );
  });

  test('preview JS renders upload/delete controls keyed by the question id', () => {
    assert.match(previewJs, /data-q-id="/);
    assert.match(previewJs, /renderDiagramControls/);
  });

  test('preview JS posts uploads to the correct admin endpoint', () => {
    assert.match(
      previewJs,
      /window\.api\.upload\(\s*['"]\/admin\/reading\/questions\/['"]\s*\+\s*encodeURIComponent\(qId\)\s*\+\s*['"]\/upload-diagram-image['"]/,
    );
  });

  test('preview JS calls DELETE via bracket notation (reserved word safe)', () => {
    // window.api.delete via `['delete']` because `delete` is a JS reserved word.
    assert.match(
      previewJs,
      /window\.api\[['"]delete['"]\]\(\s*['"]\/admin\/reading\/questions\/['"]\s*\+\s*encodeURIComponent\(qId\)\s*\+\s*['"]\/diagram-image['"]/,
    );
  });

  test('admin CSS still ships .ar-diagram-card + .ar-diagram-thumb styles (reused by preview)', () => {
    assert.match(adminCss, /\.ar-diagram-card\s*\{/);
    assert.match(adminCss, /\.ar-diagram-thumb\s*\{[\s\S]{0,400}object-fit:\s*contain/);
  });
});


// ── α.8 v2 spec docs ─────────────────────────────────────────────────

describe('Sprint 20.14f-α — v2 spec docs cover the image variant', () => {
  const spec = read('docs/clusters/20_x/reading_content_format_v2.md');

  test('§4.2 sub-section "diagram_label_completion / flow_chart_completion — image variant" exists', () => {
    assert.match(spec, /diagram_label_completion[^|]*flow_chart_completion[^|]*image variant[^|]*Sprint 20\.14f-α/);
  });

  test('spec documents the template.image_storage_path shape + signed-URL student fetch', () => {
    assert.match(spec, /template\.image_storage_path/);
    assert.match(spec, /payload\.image_url/);
    assert.match(spec, /signed URL/);
  });

  test('spec documents the ASCII mono-block back-compat fallback', () => {
    assert.match(spec, /\.exam-gap-box--mono/);
    // The fallback paragraph must mention "without image" + the legacy
    // 20.14b path so authors know that not-yet-uploaded diagrams keep
    // working.
    assert.match(spec, /[Ww]ithout image/);
  });
});


// ── α.1 Backend service shape (cross-reference) ──────────────────────

describe('Sprint 20.14f-α — services/reading_image.py contract', () => {
  const svc = read('backend/services/reading_image.py');

  test('upload_diagram_image returns the documented metadata bundle', () => {
    // Pin the public keys the renderer + admin endpoint depend on.
    for (const key of [
      'image_storage_path', 'image_size_bytes', 'image_format',
      'image_source', 'image_uploaded_at', 'image_uploaded_by',
    ]) {
      assert.match(svc, new RegExp(`["']${key}["']`), `missing return-key '${key}'`);
    }
  });

  test('size + format guards match the documented limits', () => {
    assert.match(svc, /MIN_BYTES:\s*int\s*=\s*100/);
    assert.match(svc, /MAX_BYTES:\s*int\s*=\s*5\s*\*\s*1024\s*\*\s*1024/);
    assert.match(svc, /SUPPORTED_FORMATS[\s\S]{0,100}png[\s\S]{0,40}jpg[\s\S]{0,40}webp/);
  });

  test('storage path follows tests/<test_uuid>/diagrams/<q_uuid>-manual-<ts>.<ext>', () => {
    assert.match(
      svc,
      /tests\/\{test_id\}\/diagrams\/\{question_id\}-manual-\{timestamp\}\.\{fmt\}/,
    );
  });
});


// ── α.2 Admin endpoint variant guard (cross-reference) ───────────────

describe('Sprint 20.14f-α — admin upload + delete endpoints', () => {
  const router = read('backend/routers/admin_reading.py');

  test('endpoints mount on /admin/reading/questions and target diagram/flow types only', () => {
    assert.match(router, /questions_router\s*=\s*APIRouter\([\s\S]{0,200}prefix\s*=\s*['"]\/admin\/reading\/questions['"]/);
    assert.match(router, /_DIAGRAM_FLOW_TYPES\s*=\s*\(\s*['"]diagram_label_completion['"]\s*,\s*['"]flow_chart_completion['"]/);
  });

  test('upload endpoint catches InvalidImageError → HTTPException with carried status', () => {
    assert.match(
      router,
      /except\s+InvalidImageError\s+as\s+exc:\s*\n\s*raise\s+HTTPException\(exc\.http_status,\s*str\(exc\)\)/,
    );
  });

  test('delete endpoint strips every image_* key from template', () => {
    assert.match(
      router,
      /for k in \(['"]image_storage_path['"],\s*['"]image_size_bytes['"],\s*['"]image_format['"],[\s\S]{0,400}template\.pop\(k,\s*None\)/,
    );
  });

  test('main.py mounts the questions router alongside the content router', () => {
    const main = read('backend/main.py');
    assert.match(main, /from routers\.admin_reading import questions_router as admin_reading_questions_router/);
    assert.match(main, /app\.include_router\(admin_reading_questions_router\)/);
  });
});
