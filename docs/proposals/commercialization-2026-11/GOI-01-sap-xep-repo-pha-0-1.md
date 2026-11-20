# GÓI 01 — Sắp xếp repo pha 0 (không rủi ro) và pha 1 (dời file cơ học có CI chứng minh)

## 1. Tóm tắt

- **Mục tiêu.** Agent mới vào repo đọc ít hơn, đọc đúng hơn và ít đụng nhau hơn: chỉ mục `docs/` phân biệt được tài liệu hiện hành với bằng chứng cũ; sổ spec liệt kê đủ 55 spec; hướng dẫn không còn tự mâu thuẫn; file rác bị bỏ; số migration được cấp qua một sổ máy đọc được thay vì văn xuôi 1.437 dòng; file lịch sử ở gốc repo và `docs/` được dời vào `docs/history/`; một dây chuyền Tailwind thừa bị bỏ; `AGENTS.md` và `CLAUDE.md` thôi chép trùng. Không đổi URL, API, lược đồ, hay hành vi chạy của ứng dụng.
- **Lớp thay đổi:** `small` cho mọi nhiệm vụ (`Spec: N/A`, thân PR ghi đủ Problem / Expected behavior / Scope / cách kiểm). Không nhiệm vụ nào chạm `backend/migrations/*.sql` (chạm là bị `validate_specs.py` ép thành `high-risk`, xem `HIGH_RISK_PATH_RE` trong `backend/scripts/validate_specs.py`).
- **Phụ thuộc.** Không phụ thuộc gói nào. Pha 0 làm trước pha 1. G01-T06 (sổ số migration) nên merge **trước** PR migration đầu tiên của G04 và G09. G01-T13 (Tailwind) sửa `frontend/package.json` và `.github/workflows/backend-tests.yml`, phải xếp trước hoặc sau (không song song) với nhiệm vụ G03 nào sửa build CSS. G01-T14 (gộp `AGENTS.md`/`CLAUDE.md`) nên làm sớm vì mọi phiên thực thi đều đọc hai file này. G10 (repo pha 2) dựa trên G01-T06 và G01-T01.
- **Ước lượng (giả định: người thực thi đã có worktree, `npm ci` và môi trường Python sẵn; CI không kẹt hàng).** 15 nhiệm vụ = 15 PR, khoảng 16 phiên agent. Độ khó 1–3: phần lớn là sửa tài liệu và dời file; khó nhất là T06 (sổ migration, vì ~27 test đang ghim câu chữ trong `backend/migrations/README.md`) và T14 (gộp hướng dẫn, vì test ghim câu trong `AGENTS.md`). Năm nhiệm vụ (T07, T08, T09, T11, T15) chỉ làm sau khi anh Andy trả lời mục 10.

## 2. Hiện trạng trong repo (đã kiểm ở staging @ 93c7085)

Báo cáo `S/reports/01-repo-organization.md` đo ở `c3bc7157`. Các số dưới đây đã đo lại trên `93c7085`; chỗ khác báo cáo được ghi rõ.

| Thứ cần biết | File/đường dẫn thật | Ghi chú |
| --- | --- | --- |
| Chỉ mục tài liệu | `docs/README.md` (44 dòng) | Dòng 15 trỏ "Database and migrations" tới `data-models.md`, nhưng `docs/data-models.md` **0 byte**. Dòng "Keep historical paths stable for existing links" là quy tắc mà pha 1 cần anh Andy nới (mục 10). Không test nào đọc file này. |
| `docs/` gốc | 108 file phẳng | **37 file không được file nào khác nhắc tên** (danh sách ở G01-T07). Trong 37 có 5 file là runbook/spec còn dùng, không được dời: `ADVANCED_VOCAB_CORE30_DEPLOY.md`, `ADVANCED_VOCAB_SELF_PACED_SPEC.md`, `ANDY_RUNBOOK.md`, `LEGACY_FREEZE_EXCEPTIONS.md`, `MASTER30_GRAMMAR_DIAGNOSTIC_DEPLOY.md`. |
| Sổ mốc bảo trì | `docs/REPOSITORY_MAINTENANCE.md` | Bảng mốc 2026-09-26: 7.210 entry, 60/147 router/service, 303 migration, 11 spec. Hiện tại: 8.973 entry (14 symlink), 67 router `.py`, 213 service `.py`, 365 file `.sql`, 55 thư mục spec, 159 `page.tsx`, 816 file `.py` trong `backend/tests`, 436 file trong `docs/`. Mục "Media follow-up" là kế hoạch 4 bước G10 dùng. |
| Sổ spec | `specs/README.md` (bảng "Active index"), `specs/IMPLEMENTATION_STATUS.md` | Trạng thái trong `spec.md`: 30 implementing, 16 approved, 3 draft, 3 verified, 3 shipped. `IMPLEMENTATION_STATUS.md` **thiếu** 0045, 0046, 0047, 0048, 0050, 0052, 0054 (lệnh `grep -c 0045 specs/IMPLEMENTATION_STATUS.md` → 0). Bảng index bị chèn dòng trống giữa các hàng (vỡ thành nhiều bảng khi render) và có một đoạn văn xuôi ở giữa. Va chạm số: 0006, 0007, 0022 (ID khác nhau nên hợp lệ). Thiếu số 0049, 0051, 0053. |
| Bộ kiểm spec | `backend/scripts/validate_specs.py` (1.649 dòng), job `spec-governance` trong `.github/workflows/spec-governance.yml` | Đọc từng hàng index bằng `INDEX_ROW_RE`; kiểm ID, title, status, risk, path khớp `spec.md`; báo trùng hàng. Thứ tự hàng và dòng trống không bị kiểm. `backend/tests/test_validate_specs.py` tự dựng repo giả, không đọc `specs/README.md` thật. `backend-tests.yml:110` liệt kê `specs/README.md` trong bộ lọc đường dẫn → sửa nó sẽ kéo bộ test backend chạy. |
| Nhánh của người thực thi | `docs/AGENT_WORKFLOW.md:38`, `README.md:131` | Cả hai ghi `codex/<task>`. `frontend/tooling/vercel-ignore-build.sh:59` chỉ xử lý riêng tiền tố `preview/`. |
| Runbook trỏ file lịch sử | `docs/ANDY_RUNBOOK.md:47` và `:354` | Bảo chủ dự án "Bấm theo `SMOKE_TEST_CHECKLIST.md`" — file gốc tự ghi là lịch sử. |
| Bản đồ sản phẩm | `docs/SITE_OVERVIEW.md` dòng 4–5, 226 | Ghi "130 product App Router pages", trỏ `docs/HANDOFF.md` và `admin_instructor.py` — **cả hai không tồn tại** (router thật: `admin_instructor_queue.py`, `admin_instructors.py`, `instructor.py`). Test đọc: `frontend/tests/site-overview-coverage.test.mjs`, `frontend/tests/site-overview-native-inventory.test.mjs` (không ghim số 130 hay hai đường dẫn chết). |
| File rác | `data/studio.db` (0 byte), `frontend/playwright.review-redesign.config.js` | `git grep studio.db` → không có. Config review-redesign chỉ chạy `tests/reading-native/review-correction-desk.spec.js`, spec này **đã được** `playwright.reading-native.config.js` (testDir `./tests/reading-native`, không lọc testMatch) chạy. Bẫy: `frontend/tests/route-auth-guard-inventory.test.mjs:206` `readdirSync` mọi `playwright.*.js` ở `frontend/` — xoá file vẫn qua (đếm `scanned.length >= 10`), nhưng phải chạy lại. |
| File gốc lịch sử | 14 file ở gốc: `DEPLOY_CHECKLIST.md`, `SMOKE_TEST_CHECKLIST.md`, `VOCAB_PLAN_V3.md`, `PHASE_A_V3_PLAN.md`, `PHASE_A_V3_COMPLETION.md`, `PHASE_B_V3_PLAN.md`, `PHASE_B_V3_COMPLETION.md`, `PHASE_B_V3_FINAL_STATUS.md`, `PHASE_D_V3_PLAN.md`, `PHASE_D_WAVE_2_PLAN.md`, `TECH_DEBT.md`, `PHASE_CLOSURE_LEDGER.md`, `MAPPING_COVERAGE_GAP_REPORT.md`, `MAPPING_SKELETONS_SPRINT_7.yaml` | `PHASE_CLOSURE_LEDGER.md` bị 4 test đọc: `frontend/tests/phase-closure-ledger.test.mjs`, `frontend/tests/gate-9-5-9-6-9-7-formalization.test.mjs`, `frontend/tests/cross-page-navigation-canonical.test.mjs`, `backend/tests/test_cluster_14_x_closure.py` → **không dời** trong gói này. Các file PHASE_* chỉ được nhắc trong file lịch sử khác và trong chú thích mã: `backend/routers/exercises.py`, `backend/services/d1_content_gen.py`, `backend/services/srs.py`, `backend/migrations/028_user_vocab_topic.sql` (không được sửa), `frontend/public/js/vocab-modules/exercises.js`. |
| `TECH_DEBT.md` | gốc repo | Được nhắc trong chú thích của `backend/config.py`, `backend/models/writing_feedback.py`, `backend/services/instructor_workflow.py`, `pron_calibration.py`, `vocab_content.py`, `backend/scripts/backfill_quiz_why_wrong.py`, `backend/tests/test_instructor_workflow.py:564` (chú thích, không đọc file), `backend/migrations/045_quick_to_standard_migrate.sql` (không được sửa), nhiều file `docs/`. |
| File sinh ra ở gốc | `backend/scripts/audit_mapping_coverage.py:43-44` | `REPORT_OUT = ROOT / "MAPPING_COVERAGE_GAP_REPORT.md"`, `SKELETON_OUT = ROOT / "MAPPING_SKELETONS_SPRINT_7.yaml"`; ghi ở dòng 294, 298. `backend/tests/test_grammar_audit_scope.py` nạp script này nhưng chỉ gọi `collect_articles()` (không đọc hai file đầu ra). |
| Thư mục thừa | `source_material/` + `commission/` (75 file) | Chỉ nhắc ở `docs/clusters/14_x/discovery.md` (đường dẫn `commission/sprint_14_0_preflight.md`) và chuỗi giả `'commission/x.md', 'source_material/x.txt'` ở `frontend/tests/workflow-path-coverage.test.mjs:499` (chuỗi giả, không cần thư mục tồn tại). |
| Sổ số migration | `backend/migrations/README.md` (1.437 dòng) | Dòng 20–28: "next new migration is `381`, subject to the shared migration register (ask the Leader before taking it)" — **không có file sổ nào** (`git grep -i "register.tsv"` → không). 365 file `.sql`, cao nhất `380_listening_skill_drill_homework.sql`. Lỗ số: 091 092 160 164 327 328 329 330 342 348 349 350 354 370 371 372 373 374 375. Hậu tố: `019b_`, `022b_`, `161b_`, `032_rollback.sql`. `forward-policy.tsv` 57 dòng. |
| Test ghim câu trong README migration | khoảng 27 file, ví dụ `backend/tests/test_migration_333_ai_budget.py:212-213` (`"Migration \`333\` (AIBUDGET-0033)" in readme`), `test_migration_347_listening_tests_client_revoke.py:114-115`, `test_migration_344_rls_policy_cleanup.py:126`, `test_grammar_quiz_followup_codes.py:176` | Lệnh liệt kê: `git grep -lE "MIGRATIONS ?/ ?['\"]README.md['\"]" -- backend/tests`. Cắt câu nào bị ghim là vỡ test. |
| Script chạy một lần | `backend/scripts/` (135 file phẳng + `sql/`, `agent-config/`) | **16** script không được nhắc tên ở đâu (báo cáo ghi 18; đo lại còn 16): `add_metadata_fields.py`, `archive_smoke_listening_content.py`, `audit_listening.py`, `backfill_demographic_gloss_staging.py`, `backfill_speaking_progress.py`, `check_reading_solution_depth.py`, `fix_metadata_audit.py`, `fix_metadata_audit2.py`, `fix_metadata_lists.py`, `fix_writing_feedback_prose.py`, `gv1c_backfill_admin_edits.py`, `prepare_speaking_bank_docx.py`, `regrade_listening_attempts.py`, `seed_exams.py`, `validate_grammar_learning_blocks.py`, `verify_migration_033_applied.py`. 10 file trong số này tính đường dẫn bằng `parents[...]`/`sys.path` — dời xuống một cấp thư mục là tính sai gốc. Bộ quét `backend/tests/sync_io_guard.py:45` và `test_no_raw_input_echo.py:347` bỏ qua thư mục `scripts`. |
| Tailwind thứ hai | `frontend/tailwind.config.inter.cjs`, `frontend/public/css/tailwind.inter.css`, script `build:css:inter` ở `frontend/package.json:11,13` | Không layout/trang nào nạp `tailwind.inter.css` (`git grep tailwind.inter` chỉ ra: `backend-tests.yml:552`, `package.json`, `docs/SUPABASE_REGION_MIGRATION.md:231`, hai docs audit ngày 2026-09-10, `frontend/tests/hex-budget.test.mjs:43`, `frontend/tests/primitive-families.test.mjs:31`). |
| Hướng dẫn trùng | `AGENTS.md` (239 dòng), `CLAUDE.md` (266 dòng) | Trùng: quy ước Grammar Wiki (`AGENTS.md` mục "Grammar Wiki conventions" ↔ `CLAUDE.md` "Grammar Wiki changes — inspection checklist" + "Current product realities › Grammar Wiki"), feedback quality, quyền mã kích hoạt admin, luồng staging-first. Test ghim: `frontend/tests/staging-first-release-flow.test.mjs:114-115` đòi `AGENTS.md` chứa `PR base is \`staging\`, never \`main\`` và `head \`staging\` and base \`main\``. `backend/scripts/agent-config/install.py:16` chép `frontend/CLAUDE.md` từ `agent-config/shared/frontend-claude.md` (file khác, không đụng). |
| Lệnh khôi phục runtime-config | `README.md:100-106` | Lệnh `env -u … node tooling/generate-runtime-config.mjs` 6 dòng để trả `frontend/public/js/runtime-config.js` về bản commit. Test đọc `package.json`: `frontend/tests/runtime-config.test.mjs:153` (chỉ đòi `prebuild` chứa `generate-runtime-config.mjs`), `speaking-browser-regression-contract.test.mjs:22` — thêm script mới không vỡ. |
| SQL release Reading | 10 file `backend/content/reading-practice/**/release/*.sql` (khoảng 30 MiB) | Đi kèm `release/manifest.json`; sinh bởi `backend/content/reading-practice/expansion-20261015/prepare_release.py`. `backend/tests/test_reading_expansion_authoring.py` chỉ nạp `compile_local.py`. Bản sao chỉ đọc đã bỏ nội dung các file này nên **CHƯA KIỂM** manifest có ghim SHA của chúng không: người thực thi chạy `grep -n "sql" backend/content/reading-practice/*/release/manifest.json backend/content/reading-practice/expansion-20261015/*/release/manifest.json`. |

## 3. Phạm vi

**Trong phạm vi:** mục 0.1–0.8 và 1.1–1.4, 1.6–1.12 của báo cáo 01 mục C, đã kiểm lại; mỗi mục là một nhiệm vụ ở mục 6.

**Ngoài phạm vi:**
- Dời `PHASE_CLOSURE_LEDGER.md` (4 test đọc nó) — để nguyên.
- Đổi tên thư mục spec, đánh lại số spec trùng, đổi tên/số migration cũ, chuyển `frontend/tests/*.test.mjs` vào thư mục con, dời `docs/grammar-quiz-banks/`, chạm `frontend/public/assets/advanced-vocab/**`.
- Gỡ JS cũ `frontend/public/js`, tách module backend lớn, gộp route group admin, đưa media ra khỏi git, rà 30 spec `implementing`, quy tắc đặt số migration không va chạm → **G10**.
- Sửa nội dung bên trong file lịch sử (chỉ dời và sửa link trỏ tới chúng).

## 4. Yêu cầu

- **FR-01-001** `docs/README.md` không còn trỏ tới file rỗng: dòng "Database and migrations" trỏ tới file có nội dung.
- **FR-01-002** `docs/README.md` có bảng thứ hai "Historical evidence" liệt kê theo họ (Gate A–F, cutover, spike, pilot, sprint, handoff, audit, plan) mọi file có ngày ở `docs/` gốc, kèm ngày và tài liệu thay thế nếu có.
- **FR-01-003** `specs/IMPLEMENTATION_STATUS.md` có đủ một hàng cho mỗi thư mục spec (55); bảng index `specs/README.md` là **một** bảng liền, sắp theo số rồi theo ID, đoạn văn xuôi chuyển xuống dưới bảng; `python backend/scripts/validate_specs.py` qua.
- **FR-01-004** Bảng mốc trong `docs/REPOSITORY_MAINTENANCE.md` có thêm cột/ngày mới với số đo hiện tại, giữ nguyên số mốc cũ.
- **FR-01-005** Không còn hướng dẫn mâu thuẫn: runbook không bảo làm theo file lịch sử; câu về tiền tố nhánh khớp quy ước thật; `SITE_OVERVIEW.md` không trỏ tới file không tồn tại.
- **FR-01-006** `data/studio.db` và `frontend/playwright.review-redesign.config.js` bị xoá; mọi bộ test vẫn qua.
- **FR-01-007** `README.md` có đoạn "Where things live" phân biệt `scripts/` (ops) và `backend/scripts/` (ứng dụng/nội dung), và năm nơi chứa nội dung.
- **FR-01-008** Có lệnh `npm --prefix frontend run config:reset` khôi phục `runtime-config.js`; README và `docs/AGENT_WORKFLOW.md` dùng lệnh này.
- **FR-01-009** Có `backend/migrations/register.tsv` liệt kê mọi số đã dùng và đã giữ chỗ; một test backend thất bại khi có file `.sql` mới không có hàng trong sổ, hoặc hai file forward cùng số (trừ biến thể đã liệt kê), hoặc một số giữ chỗ không ghi chủ.
- **FR-01-010** Các file `docs/` gốc không ai nhắc (trừ 5 runbook/spec còn dùng) nằm dưới `docs/history/<họ>/`; bảng FR-01-002 trỏ đường dẫn mới. (Chỉ khi anh Andy duyệt quyết định Q1.)
- **FR-01-011** 10 file gốc lịch sử (trừ `TECH_DEBT.md`, `PHASE_CLOSURE_LEDGER.md`, hai file `MAPPING_*`) nằm dưới `docs/history/root/`; mọi tham chiếu trong repo (trừ file `.sql`) trỏ đường dẫn mới. (Khi Q1 được duyệt.)
- **FR-01-012** `TECH_DEBT.md` chỉ còn một vai trò: hoặc backlog sống, hoặc lịch sử — theo Q2.
- **FR-01-013** `audit_mapping_coverage.py` ghi đầu ra vào thư mục bị git bỏ qua; hai file `MAPPING_*` không còn được theo dõi ở gốc.
- **FR-01-014** `source_material/` và `commission/` theo quyết định Q3 (xoá hoặc dời `docs/history/`).
- **FR-01-015** 16 script không ai nhắc được xử lý theo Q4; script còn lại không đổi.
- **FR-01-016** Không còn build/guard `tailwind.inter.css`; `tailwind.build.css` vẫn được CI kiểm.
- **FR-01-017** Mỗi quy tắc dùng chung chỉ có một bản: ở `AGENTS.md`; `CLAUDE.md` chỉ còn phần riêng cho Claude và link/`@AGENTS.md`.
- **FR-01-018** SQL release Reading theo Q5.

## 5. Hợp đồng kỹ thuật

### 5.1 Bộ kiểm chuẩn mỗi PR của gói (gọi là "BỘ KIỂM ĐẦY ĐỦ")

Theo `docs/AGENT_WORKFLOW.md` mục "Local verification" và 00 §5.3, chạy từ gốc worktree:

```bash
cd backend && python -m pytest tests/ -q ; cd ..
node --import ./frontend/tests/fixtures/legacy-html-retired/loader.mjs --test frontend/tests/*.test.mjs frontend/tests/*.test.js
npm --prefix frontend run test:react
(cd frontend && npx tsc --noEmit && npx tsc --noEmit -p tsconfig.legacy.json && npm run build)
python backend/scripts/validate_specs.py
git diff --check
```

Nhiệm vụ chỉ sửa Markdown ngoài `specs/` vẫn chạy bộ contract frontend (nhiều test đọc `docs/`) và `validate_specs.py`; ghi trong PR nếu bỏ qua bộ backend kèm lý do "không đổi file .py/.sql/.tsv". Ghi số test chạy/bỏ qua.

### 5.2 Lệnh chứng minh "không ai tham chiếu"

Với mỗi file F sắp xoá/dời, chạy và dán kết quả vào thân PR:

```bash
F=ten_file.ext
git grep -n -F "$F" -- . ":!$F"                       # tên file ở bất kỳ đâu
git grep -n -F "${F%.*}" -- frontend/tests frontend/tooling backend/tests backend/scripts scripts .github
```

Kết quả mong đợi: rỗng, hoặc chỉ còn dòng trong bảng chỉ mục mà chính PR sửa. Ngoài tên file, kiểm thêm bộ quét theo thư mục: `git grep -nE "readdirSync|glob\(|rglob|iterdir|os\.walk" -- frontend/tests frontend/tooling backend/tests | grep -i "<thư mục cha>"`.

### 5.3 `backend/migrations/register.tsv`

Tab-separated, dòng đầu là tiêu đề, dòng `#` là chú thích:

| Cột | Kiểu | Ràng buộc |
| --- | --- | --- |
| `number` | 3 chữ số, có thể kèm hậu tố chữ (`019b`) | duy nhất trong sổ |
| `filename` | tên file trong `backend/migrations/` hoặc `-` | `-` khi chỉ giữ chỗ hoặc số bỏ |
| `state` | `present` \| `reserved` \| `abandoned` | `present` ⇔ file tồn tại; `reserved` phải có `owner`; `abandoned` = số không bao giờ dùng (091, 092…) |
| `owner` | PR (`#2294`), mã nhiệm vụ (`G04-T03`) hoặc `-` | bắt buộc khi `reserved` |
| `spec` | ID spec hoặc `-` | |
| `note` | văn bản ngắn, không tab | |

`032_rollback.sql` có hàng `number=032r` (hoặc ghi chú) với `state=present` và note "rollback, không phải forward"; test không coi nó là số trùng. Test mới: `backend/tests/test_migration_register.py` — đọc thư mục `backend/migrations/*.sql` và sổ, kiểm 4 điều ở FR-01-009 và kiểm "số kế tiếp" = max số `present`/`reserved` + 1 được in ra khi chạy `python -m pytest tests/test_migration_register.py -q -s`. Đây là test dữ liệu (so tên file với sổ), không phải test đọc mã nguồn so chuỗi — hợp lệ theo 00 §4.9.

## 6. Nhiệm vụ (theo thứ tự phụ thuộc)

### G01-T01 — Sửa chỉ mục tài liệu, lập bảng bằng chứng lịch sử, làm mới mốc bảo trì (0.1, 0.2, 0.4)

- **Mục đích:** agent mở `docs/README.md` biết ngay file nào hiện hành.
- **Đầu vào:** `docs/README.md`, `docs/REPOSITORY_MAINTENANCE.md`, `ls -p docs | grep -v /`, `backend/migrations/README.md` dòng 1–30.
- **Việc làm:**
  1. `docs/README.md:15`: thay `[Data models](data-models.md)` bằng link tới `../backend/migrations/README.md` và `backend/tests/README.md`; xoá `docs/data-models.md` (0 byte) trong cùng PR **nếu** Q6 = "trỏ lại" (mặc định tạm). Nếu Q6 = "viết", để nguyên file và ghi `CẦN ANH ANDY QUYẾT` trong PR.
  2. Thêm mục `## Historical evidence` sau "Document lifecycle": bảng `Family | File | Date | Superseded by`. Họ: Gate A–F (`GATE_*`), Cutover (`CUTOVER_*`), Spike (`SPIKE_*`), Pilot (`PILOT_*`), Sprint (`sprint-*`), Handoff (`HANDOFF_*`), Audit/QA (`AUDIT_*`, `QA2_*`), Plan/Proposal (`*_PLAN*`, `*proposal*`), Incident (`*INCIDENT*`). Lấy ngày từ tên file; không có ngày thì ghi ngày commit cuối (`git log -1 --format=%cs -- docs/<file>` trên bản clone đầy đủ). Cột "Superseded by" chỉ điền khi file tự ghi; còn lại `-`.
  3. `docs/REPOSITORY_MAINTENANCE.md`: thêm cột `2026-11-16 (staging 93c7085)` vào bảng mốc với số ở mục 2 của gói này; đo lại trên `origin/staging` mới nhất bằng các lệnh: `git ls-files | wc -l`, `git ls-files -s | awk '$1==120000' | wc -l`, `ls backend/routers/*.py | wc -l`, `find backend/services -name '*.py' | wc -l`, `ls backend/migrations/*.sql | wc -l`, `ls -d specs/[0-9]*/ | wc -l`, `find frontend/app -name page.tsx | wc -l`. Không xoá cột cũ.
- **Đầu ra:** 1 PR sửa 2 file (+ xoá `docs/data-models.md`).
- **Nghiệm thu:** `grep -n "data-models" docs/README.md` → không còn; mỗi file trong `ls -p docs | grep -v / | grep -E "20[0-9]{2}-[0-9]{2}-[0-9]{2}|^sprint-|^GATE_|^SPIKE_|^CUTOVER_|^HANDOFF_|^PILOT_|^AUDIT_|^QA2_"` xuất hiện trong bảng mới (kiểm bằng vòng lặp `for f in …; do grep -q "$f" docs/README.md || echo THIEU $f; done` → rỗng); BỘ KIỂM ĐẦY ĐỦ phần frontend + `validate_specs.py` qua.
- **Không làm:** không dời file; không sửa nội dung file lịch sử.
- **Vướng mắc → cách gỡ:**
  - `git log` trả về một commit (bản sao nông) → `git fetch --unshallow` trong worktree của người thực thi; không có thì để cột Date theo tên file và ghi "ngày theo tên file".
  - Một file vừa là runbook vừa có ngày (ví dụ `GATE_F_LEGACY_RETIREMENT_RUNBOOK_2026-08-16.md`) → xếp vào bảng lịch sử nhưng ghi note "runbook theo ngày"; không đưa vào bảng "Start here".
- **Ước lượng:** 1 phiên · độ khó 1.

### G01-T02 — Sửa sổ spec (0.3)

- **Mục đích:** biết được việc gì đang dở chỉ bằng đọc sổ.
- **Đầu vào:** `specs/README.md` mục "Active index", `specs/IMPLEMENTATION_STATUS.md`, `spec.md` của 0045, 0046, 0047, 0048, 0050, 0052, 0054 (frontmatter + mục Requirements), `tasks.md` và `verification.md` của các spec đó.
- **Việc làm:**
  1. Thêm 7 hàng vào bảng "Feature ledger" của `IMPLEMENTATION_STATUS.md`, theo khuôn các hàng hiện có: cột 2 = điều đã có (đếm task `[x]`/tổng trong `tasks.md`, PR đã merge nếu `verification.md` ghi), cột 3 = việc nghiệm thu còn lại. Chỉ chép điều file spec ghi; không suy từ việc mã tồn tại.
  2. Thêm dòng "Reconciled on 2026-11-xx (0045–0054, staging `<sha>`)" ở đầu file.
  3. `specs/README.md`: gộp các hàng index thành một bảng liền (xoá dòng trống giữa hàng), sắp theo số thư mục rồi theo ID; chuyển đoạn "Progress and remaining acceptance…" xuống ngay dưới bảng; thêm ghi chú: "Spec numbers 0006, 0007 and 0022 are each used by two features; the ID, not the number, is unique. 0049, 0051 and 0053 are unused."
  4. Không đổi chữ trong từng hàng (title/status/risk/path phải khớp `spec.md`, validator kiểm).
- **Đầu ra:** 1 PR, 2 file.
- **Nghiệm thu:** `python backend/scripts/validate_specs.py` → 0 lỗi; `for d in specs/[0-9]*/; do id=$(grep -m1 '^id:' $d/spec.md | cut -d' ' -f2); grep -q "$id" specs/IMPLEMENTATION_STATUS.md || echo THIEU $id; done` → rỗng; `awk '/^## Active index/,/^Progress/' specs/README.md | grep -c '^$'` → 1 (chỉ dòng trống sau tiêu đề); `cd backend && python -m pytest tests/test_validate_specs.py -q` qua.
- **Không làm:** không đổi status của spec nào (việc đó là G10-T13/T14); không sửa thư mục spec.
- **Vướng mắc → cách gỡ:**
  - `IMPLEMENTATION_STATUS.md` ghi "implementing (was approved)" cho STORAGELIMITS-0038 trong khi `spec.md` ghi `approved` → không sửa status; ghi chỗ lệch vào thân PR để G10-T13 xử lý.
  - 0049/0051/0053 có thể đang được PR mở giữ → kiểm `gh pr list --state open --search "0049 OR 0051 OR 0053"`; nếu có, ghi "reserved by #NNNN" thay vì "unused".
- **Ước lượng:** 1 phiên · độ khó 2.

### G01-T03 — Sửa hai hướng dẫn mâu thuẫn và bản đồ sản phẩm (0.5, 0.6)

- **Mục đích:** không agent nào làm theo chỉ dẫn đã chết.
- **Đầu vào:** `docs/ANDY_RUNBOOK.md` dòng 40–50 và 350–356, `docs/AGENT_WORKFLOW.md:38`, `README.md:131`, `docs/SITE_OVERVIEW.md` dòng 1–10 và 226, `docs/STAGING_FIRST_RELEASE_FLOW.md`.
- **Việc làm:**
  1. `docs/ANDY_RUNBOOK.md:47` và `:354`: thay "Bấm theo `SMOKE_TEST_CHECKLIST.md`" bằng trỏ tới mục `## Normal release` của `docs/STAGING_FIRST_RELEASE_FLOW.md` (bước 4: push vào `staging` chạy Staging E2E và staging smoke), giữ nguyên câu "kiểm cả tính năng CŨ" vì đó là lời dặn riêng cho chủ dự án.
  2. `docs/AGENT_WORKFLOW.md:38` và `README.md:131`: viết lại câu thành "a scoped topic branch (`codex/<task>`; use `preview/<slug>` only to request a Vercel preview)". Giữ nguyên các câu khác.
  3. `docs/SITE_OVERVIEW.md`: dòng 4 đổi "130 product App Router pages" thành "159 `page.tsx` files on <ngày>; product pages exclude `NON_PRODUCT_APP_PAGE_ROUTES` in `frontend/tooling/app-route-inventory.mjs`" (file đó là module, không phải lệnh CLI; không tự đếm trang sản phẩm bằng tay); dòng 5 bỏ cụm về `docs/HANDOFF.md`; dòng 226 thay `admin_instructor.py` bằng `admin_instructors.py`, `admin_instructor_queue.py`.
- **Đầu ra:** 1 PR, 4 file.
- **Nghiệm thu:** `git grep -n "SMOKE_TEST_CHECKLIST" docs/ANDY_RUNBOOK.md` → không còn (hoặc chỉ còn dạng có chú thích lịch sử); `git grep -n "HANDOFF.md\|admin_instructor.py" docs/SITE_OVERVIEW.md` → rỗng; `node --import ./frontend/tests/fixtures/legacy-html-retired/loader.mjs --test frontend/tests/site-overview-coverage.test.mjs frontend/tests/site-overview-native-inventory.test.mjs frontend/tests/staging-first-release-flow.test.mjs frontend/tests/vercel-ignore-build.test.mjs` qua; sau đó bộ contract đầy đủ qua.
- **Không làm:** không viết lại toàn bộ `SITE_OVERVIEW.md`; không đổi quy ước nhánh trong `AGENTS.md`.
- **Vướng mắc → cách gỡ:**
  - `frontend/tests/vercel-ignore-build.test.mjs:189` liệt kê `docs/AGENT_WORKFLOW.md` là đường dẫn "SKIP build" → chỉ sửa nội dung, không đổi tên file, test giữ nguyên.
  - `site-overview-coverage.test.mjs` đòi `README.md` vẫn link `docs/SITE_OVERVIEW.md` (dòng 39–42) → không đụng link đó ở README.
- **Ước lượng:** 1 phiên · độ khó 1.

### G01-T04 — Xoá hai file không ai tham chiếu (0.7)

- **Mục đích:** bớt rác ở gốc và trong `frontend/`.
- **Đầu vào:** `frontend/playwright.review-redesign.config.js`, `frontend/playwright.reading-native.config.js`, `frontend/tests/route-auth-guard-inventory.test.mjs:195-222`.
- **Việc làm:** `git rm data/studio.db frontend/playwright.review-redesign.config.js`. Giữ `data/rubric/` (đọc bởi `backend/tests/test_rubric_and_prompt_uplift.py`).
- **Đầu ra:** 1 PR xoá 2 file.
- **Nghiệm thu:** lệnh 5.2 cho `studio.db` và `review-redesign` → rỗng; `node --import … --test frontend/tests/route-auth-guard-inventory.test.mjs frontend/tests/workflow-path-coverage.test.mjs` qua; `cd frontend && npx playwright test -c playwright.reading-native.config.js --list | grep review-correction-desk` → còn liệt kê (chứng minh spec vẫn được chạy); BỘ KIỂM ĐẦY ĐỦ qua.
- **Không làm:** không xoá `playwright.spike.config.js` (bị `route-auth-guard-inventory.test.mjs:220` đọc).
- **Vướng mắc → cách gỡ:** `review-correction-desk.spec.js` ghi ảnh vào `/tmp/...` → không liên quan việc xoá config; không sửa.
- **Ước lượng:** 1 phiên · độ khó 1.

### G01-T05 — "Where things live" trong README và lệnh `config:reset` (0.8, 1.11)

- **Mục đích:** agent biết đặt script/nội dung ở đâu; khôi phục `runtime-config.js` bằng một lệnh.
- **Đầu vào:** `README.md` (199 dòng; dòng 95–106), `frontend/package.json`, `frontend/tooling/generate-runtime-config.mjs`, `docs/AGENT_WORKFLOW.md`.
- **Việc làm:**
  1. Thêm vào `frontend/package.json` mục `scripts`: `"config:reset": "env -u VERCEL_ENV -u VERCEL_GIT_COMMIT_SHA -u VERCEL_GIT_COMMIT_REF -u AVER_ENVIRONMENT -u AVER_API_BASE -u AVER_SUPABASE_URL -u AVER_SUPABASE_ANON_KEY -u AVER_CORE_OPERATION_CORRELATION_ENABLED -u AVER_WRITING_ADMISSION_ENABLED -u AVER_RUNTIME_CONFIG_OUT node tooling/generate-runtime-config.mjs"` (đúng danh sách biến ở `README.md:101-105`).
  2. `README.md`: thay khối lệnh 6 dòng bằng `npm --prefix frontend run config:reset`, giữ một câu nói lệnh đó làm gì. `docs/AGENT_WORKFLOW.md`: nơi nhắc khôi phục runtime-config (người thực thi `grep -n runtime-config docs/AGENT_WORKFLOW.md`) trỏ lệnh mới.
  3. Thêm mục `## Where things live` vào `README.md`: `scripts/` = ops repo (`backup/`, `hooks/`, `ci/`, `e2e-staging/`); `backend/scripts/` = công cụ ứng dụng/nội dung; nội dung ở `backend/content/<category>/` (Grammar Wiki, thư mục = category), `backend/content/reading-practice/`, `backend/content/advanced_vocab/` + `frontend/public/assets/advanced-vocab/`, `docs/grammar-quiz-banks/` (nguồn nhập ngân hàng câu hỏi, không phải tài liệu), `backend/data/`.
- **Đầu ra:** 1 PR, 3 file.
- **Nghiệm thu:** chạy `cd frontend && AVER_ENVIRONMENT=test node tooling/generate-runtime-config.mjs && npm run config:reset && git diff --exit-code public/js/runtime-config.js` → exit 0; `node --import … --test frontend/tests/runtime-config.test.mjs frontend/tests/agent-launcher.test.mjs frontend/tests/site-overview-coverage.test.mjs frontend/tests/speaking-browser-regression-contract.test.mjs` qua; bộ contract đầy đủ qua.
- **Không làm:** không đổi `generate-runtime-config.mjs`.
- **Vướng mắc → cách gỡ:**
  - `env -u` không có trên Windows → repo chỉ dùng macOS/Linux (CI ubuntu); ghi trong PR.
  - `agent-launcher.test.mjs:128` đọc `README.md` → chạy nó trước khi đẩy; nếu nó ghim đúng khối lệnh cũ, giữ khối cũ trong `<details>` và thêm lệnh mới phía trên, báo trong PR.
- **Ước lượng:** 1 phiên · độ khó 1.

### G01-T06 — Sổ đăng ký số migration (1.7)

- **Mục đích:** hai phiên thực thi không lấy trùng số migration; người thực thi không phải đọc 1.437 dòng để biết số kế tiếp.
- **Đầu vào:** `backend/migrations/README.md` (toàn bộ; mục "Numbering quirks", "Finding the next number"), `backend/migrations/forward-policy.tsv`, `backend/scripts/apply_migrations.sh` (dòng 1–110; dòng 104 `for f in $(ls "$MIG_DIR"/*.sql | sort)`), `backend/tests/test_migration_forward_policy.py`, danh sách test ghim README ở mục 2.
- **Việc làm:**
  1. Lập danh sách câu bị ghim: `git grep -hoE "in readme[^\n]*|in \(MIGRATIONS / ['\"]README.md['\"]\)\.read_text\(\)" -- backend/tests` rồi mở từng test, chép chuỗi được `assert ... in readme` vào một danh sách tạm (không commit).
  2. Tạo `backend/migrations/register.tsv` theo 5.3: một hàng `present` cho mỗi file `.sql` (365); một hàng `abandoned` cho 091, 092 và mọi lỗ số mà README nói là bỏ; một hàng `reserved` cho mỗi số README nói đang giữ (người thực thi đọc README, ví dụ "370–375 remain held by their owners", "353–359 without a file here may be held by open PRs") kèm owner như README ghi; lỗ số README không giải thích → `reserved`, owner `unknown-ask-owner`, và liệt kê trong PR để anh Andy xác nhận.
  3. Tạo `backend/tests/test_migration_register.py` kiểm FR-01-009 (đọc tên file bằng `Path.glob("*.sql")`, không đọc nội dung SQL). Cho phép `owner=unknown-ask-owner` nhưng in cảnh báo.
  4. `backend/migrations/README.md`: thay đoạn "Finding the next number" bằng: "Take the next number after the highest `present` or `reserved` row in `register.tsv`, add your row (`reserved`, owner = your PR or task ID) in the same PR as the file, and change it to `present` when the file lands." **Giữ nguyên mọi câu nằm trong danh sách bước 1.** Chỉ được cắt các đoạn giữ chỗ không bị test ghim và đã chuyển sang sổ.
  5. Ghi một dòng vào `docs/AGENT_WORKFLOW.md` (mục migration nếu có, không thì cuối mục "Local verification"): "Migration numbers: see `backend/migrations/register.tsv`."
- **Đầu ra:** 1 PR: 1 file `.tsv` mới, 1 test mới, README và AGENT_WORKFLOW sửa. Không file `.sql` nào đổi.
- **Nghiệm thu:** `cd backend && python -m pytest tests/test_migration_register.py tests/test_migration_forward_policy.py -q` qua; thử âm: tạo tạm `backend/migrations/381_tmp.sql` rỗng → test register **thất bại** với thông báo "381_tmp.sql has no register row"; xoá file tạm; `cd backend && python -m pytest tests/ -q -k "migration"` qua (bắt test ghim README); BỘ KIỂM ĐẦY ĐỦ qua; `git diff --stat -- backend/migrations/*.sql` → rỗng.
- **Không làm:** không đổi tên/số file migration; không sửa `apply_migrations.sh`; không đổi `forward-policy.tsv`; không đặt quy tắc dải số theo gói (đó là G10-T15).
- **Vướng mắc → cách gỡ:**
  - Cắt nhầm câu bị ghim → test `test_migration_3xx_*` báo `AssertionError` với chuỗi; khôi phục câu đó nguyên văn (kể cả dấu backtick). Không sửa test.
  - Hai PR khác (G04/G09) cùng lúc thêm migration trước khi T06 merge → T06 rebase, thêm hàng cho file mới; nếu trùng số thật, dừng và báo anh Andy (không tự đổi số file của PR khác).
  - `032_rollback.sql` và `019b`/`022b`/`161b` làm test "trùng số" báo sai → khai rõ trong sổ (hàng riêng có hậu tố) và test coi `NNN` + hậu tố chữ là số riêng; `032_rollback` nhận diện qua `_rollback` trong tên.
  - Đọc README thấy số giữ chỗ đã quá cũ (owner là PR đã đóng) → vẫn ghi `reserved` như README, liệt kê trong PR mục "Cần anh Andy quyết: giải phóng số NNN?".
- **Ước lượng:** 2 phiên · độ khó 3.

### G01-T07 — Dời file `docs/` không ai nhắc vào `docs/history/` (1.1) — chỉ khi Q1 = có

- **Mục đích:** `docs/` gốc chỉ còn tài liệu hiện hành.
- **Đầu vào:** bảng lịch sử từ T01; danh sách 37 file (lệnh: `for f in $(ls -p docs | grep -v /); do [ $(git grep -l -F "$f" -- . ":!docs/$f" | wc -l) -eq 0 ] && echo $f; done`).
- **Việc làm:**
  1. Chạy lại lệnh trên `origin/staging` mới nhất; danh sách có thể khác 37.
  2. Bỏ ra khỏi danh sách: `ADVANCED_VOCAB_CORE30_DEPLOY.md`, `ADVANCED_VOCAB_SELF_PACED_SPEC.md`, `ANDY_RUNBOOK.md`, `LEGACY_FREEZE_EXCEPTIONS.md`, `MASTER30_GRAMMAR_DIAGNOSTIC_DEPLOY.md`, và mọi file có trong bảng "Start here".
  3. `git mv docs/<f> docs/history/<họ>/<f>` (họ: `gate`, `cutover`, `spike`, `sprint`, `handoff`, `audit`, `plan`, `incident`, `other`). Giữ nguyên tên file.
  4. Sửa link tương đối **bên trong** file đã dời (chỉ `GATE_F_LEGACY_RETIREMENT_RUNBOOK_2026-08-16.md` có 3 link tương đối ở thời điểm kiểm): thêm `../../` cho đúng.
  5. Cập nhật bảng lịch sử trong `docs/README.md` sang đường dẫn mới; sửa câu "Keep historical paths stable for existing links" theo đúng chữ anh Andy duyệt ở Q1.
- **Đầu ra:** 1 PR (khoảng 32 lần `git mv` + 1 file sửa).
- **Nghiệm thu:** với mỗi file đã dời, lệnh 5.2 trên tên file → chỉ ra `docs/README.md`; kiểm link: `grep -oE "\]\([^)]+\)" docs/history -r | …` từng link tương đối trỏ tới file tồn tại (người thực thi viết vòng lặp `test -e`); bộ contract frontend và `validate_specs.py` qua; `git log --follow --oneline -- docs/history/<họ>/<f> | wc -l` > 1 (lịch sử còn).
- **Không làm:** không dời file được nhắc ở bất kỳ đâu; không dời thư mục con của `docs/`; không dời `docs/grammar-quiz-banks/`.
- **Vướng mắc → cách gỡ:**
  - Link từ issue/PR cũ trên GitHub tới đường dẫn cũ sẽ 404 → đây là lý do cần Q1; không tạo file chuyển hướng.
  - Test nào đó quét `docs/*.md` theo glob (`frontend/tests/workflow-path-coverage.test.mjs:430` chỉ là test mẫu khớp glob, không đọc thư mục) → nếu test vỡ, đọc thông báo, không sửa test để bỏ qua; báo.
- **Ước lượng:** 1 phiên · độ khó 2.

### G01-T08 — Dời 10 file gốc lịch sử vào `docs/history/root/` (1.2) — chỉ khi Q1 = có

- **Mục đích:** gốc repo còn khoảng 9 file.
- **Đầu vào:** mục 2 (bảng tham chiếu), lệnh `for f in DEPLOY_CHECKLIST SMOKE_TEST_CHECKLIST VOCAB_PLAN_V3 PHASE_A_V3_PLAN PHASE_A_V3_COMPLETION PHASE_B_V3_PLAN PHASE_B_V3_COMPLETION PHASE_B_V3_FINAL_STATUS PHASE_D_V3_PLAN PHASE_D_WAVE_2_PLAN; do echo "== $f"; git grep -n "$f" -- . ":!$f.md"; done`.
- **Việc làm:**
  1. `git mv` 10 file trên vào `docs/history/root/`.
  2. Sửa tham chiếu trong: `backend/routers/exercises.py`, `backend/services/d1_content_gen.py`, `backend/services/srs.py`, `frontend/public/js/vocab-modules/exercises.js` (chỉ chú thích: thêm tiền tố `docs/history/root/`), `docs/ANDY_RUNBOOK.md`, `docs/audits/AUDIT_PHASE_B_V3.md`, và các file lịch sử dời cùng nhau (link qua lại giữ tương đối cùng thư mục nên không cần sửa).
  3. **Không sửa** `backend/migrations/028_user_vocab_topic.sql` (00 §4.11) — chú thích cũ trong file SQL được phép trỏ tên cũ; ghi trong PR.
  4. `DEPLOY_CHECKLIST.md` có 2 link tương đối, `PHASE_D_V3_PLAN.md` có 1 → sửa thành `../../../<đích>`.
  5. Thêm hàng vào bảng lịch sử ở `docs/README.md`.
- **Đầu ra:** 1 PR.
- **Nghiệm thu:** `ls *.md` ở gốc chỉ còn `AGENTS.md CLAUDE.md README.md TECH_DEBT.md PHASE_CLOSURE_LEDGER.md` (+ `MAPPING_*` nếu T10 chưa merge); lệnh vòng lặp ở "Đầu vào" chỉ còn dòng trong `docs/history/`, `docs/README.md` và `028_user_vocab_topic.sql`; BỘ KIỂM ĐẦY ĐỦ qua (đổi chú thích trong `.py`/`.js` → chạy cả backend và `tsc -p tsconfig.legacy.json`).
- **Không làm:** không dời `PHASE_CLOSURE_LEDGER.md`, `TECH_DEBT.md` (T09), `MAPPING_*` (T10).
- **Vướng mắc → cách gỡ:**
  - Sửa chú thích trong `frontend/public/js/vocab-modules/exercises.js` kéo workflow `legacy-freeze.yml` và `route-manifest.yml` chạy (bộ lọc `frontend/public/**`) → bình thường, để chúng chạy xong.
  - `backend/tests/test_no_raw_input_echo.py`/`sync_in_async_allowlist.tsv` ghim số dòng? → không (khoá theo tên hàm), sửa chú thích không đổi khoá.
- **Ước lượng:** 1 phiên · độ khó 2.

### G01-T09 — Một backlog duy nhất cho `TECH_DEBT.md` (1.3) — theo Q2

- **Mục đích:** hết cảnh "historical snapshot" ở đầu file và "ACTIVE" trong thân.
- **Đầu vào:** `TECH_DEBT.md` (đầu file và mục ACTIVE), `docs/brand/README.md`, `docs/phase_b_backlog.md`, `docs/PHASE_B_BACKLOG_2026_05_25.md`.
- **Việc làm:** Q2 = "specs là backlog duy nhất" (mặc định tạm đề nghị): giữ `TECH_DEBT.md` ở gốc (đang được ~20 file nhắc), sửa đoạn đầu thành "Historical backlog, frozen on <ngày>. New work: open a spec under `specs/` or an issue." và đổi nhãn mục ACTIVE thành "Last active list (frozen)"; `docs/brand/README.md`: thay câu "schedule … in `TECH_DEBT.md`" bằng trỏ `specs/`. Q2 = "TECH_DEBT là backlog sống": bỏ nhãn historical ở đầu, ghi ngày cập nhật, không đụng thân.
- **Đầu ra:** 1 PR, 2 file.
- **Nghiệm thu:** `head -15 TECH_DEBT.md` chỉ còn một vai trò; bộ contract frontend + backend (`test_instructor_workflow.py` có chú thích nhắc file) qua.
- **Không làm:** không dời file; không xoá mục nào trong thân.
- **Vướng mắc → cách gỡ:** file 153 KB, editor chậm → sửa bằng `Edit` chỉ đoạn đầu.
- **Ước lượng:** 1 phiên · độ khó 1.

### G01-T10 — Đầu ra `audit_mapping_coverage.py` ra khỏi gốc (1.4)

- **Mục đích:** script không làm bẩn gốc repo.
- **Đầu vào:** `backend/scripts/audit_mapping_coverage.py` (dòng 1–45, 290–312), `.gitignore`, `backend/tests/test_grammar_audit_scope.py`.
- **Việc làm:**
  1. Đổi dòng 43–44 thành `OUT_DIR = ROOT / "backend" / ".audit-output"`, `REPORT_OUT = OUT_DIR / "MAPPING_COVERAGE_GAP_REPORT.md"`, `SKELETON_OUT = OUT_DIR / "MAPPING_SKELETONS_SPRINT_7.yaml"`; trước khi ghi (dòng ~294) `OUT_DIR.mkdir(parents=True, exist_ok=True)`. Sửa docstring dòng 7, 12.
  2. Thêm `backend/.audit-output/` vào `.gitignore`.
  3. `git rm MAPPING_COVERAGE_GAP_REPORT.md MAPPING_SKELETONS_SPRINT_7.yaml`.
- **Đầu ra:** 1 PR.
- **Nghiệm thu:** `python3 backend/scripts/audit_mapping_coverage.py` → in "Wrote: backend/.audit-output/…"; `git status --short` sau khi chạy → sạch; `cd backend && python -m pytest tests/test_grammar_audit_scope.py -q` qua; BỘ KIỂM ĐẦY ĐỦ phần backend qua.
- **Không làm:** không đổi logic thu thập.
- **Vướng mắc → cách gỡ:** dòng 311 dùng `REPORT_OUT.relative_to(ROOT)` — vẫn đúng vì `OUT_DIR` nằm dưới `ROOT`.
- **Ước lượng:** 1 phiên · độ khó 1.

### G01-T11 — `source_material/` và `commission/` (1.6) — theo Q3

- **Mục đích:** bỏ 2 thư mục gốc không có người dùng.
- **Đầu vào:** `git ls-files source_material commission`, `docs/clusters/14_x/discovery.md`, `frontend/tests/workflow-path-coverage.test.mjs:496-502`.
- **Việc làm:** Q3 = "xoá" (mặc định tạm đề nghị; Git giữ lịch sử): `git rm -r source_material`; `git mv commission docs/history/commission` (vì `discovery.md` nhắc `commission/sprint_14_0_preflight.md`) và sửa 6 chỗ nhắc trong `docs/clusters/14_x/discovery.md` thành `docs/history/commission/…`. Q3 = "dời cả hai": `git mv` cả hai vào `docs/history/`.
- **Đầu ra:** 1 PR.
- **Nghiệm thu:** `ls source_material commission` → không tồn tại; `node --import … --test frontend/tests/workflow-path-coverage.test.mjs` qua (chuỗi giả không cần thư mục); `git grep -n "commission/sprint_14_0" -- . ":!docs/history"` → chỉ ra đường dẫn mới; bộ contract frontend qua.
- **Không làm:** không sửa `workflow-path-coverage.test.mjs`.
- **Vướng mắc → cách gỡ:** `backend-tests.yml` bộ lọc đường dẫn coi thay đổi ngoài danh sách là "chạy test" (chú thích dòng 70) → PR sẽ chạy bộ test đầy đủ; bình thường.
- **Ước lượng:** 1 phiên · độ khó 1.

### G01-T12 — Gom 16 script chạy một lần (1.8) — theo Q4

- **Mục đích:** `backend/scripts/` bớt 16 file không ai gọi.
- **Đầu vào:** danh sách 16 file ở mục 2; lệnh kiểm `for f in <16 file>; do m=${f%.py}; git grep -l -e "$f" -e "scripts\.$m\b" -e "import $m\b" -e "from $m import" -- . ":!backend/scripts/$f"; done` (phải rỗng).
- **Việc làm:**
  - Q4 = "xoá, Git giữ lịch sử" (mặc định tạm đề nghị): `git rm` các file; không tạo README mới trong `backend/scripts/` (hiện không có); thêm vào bảng lịch sử ở `docs/README.md` một hàng "Removed one-off scripts (G01-T12): <danh sách>; recover with `git show <sha-trước-xoá>:backend/scripts/<f>`".
  - Q4 = "dời vào `backend/scripts/archive/`": `git mv`; với 10 file có `parents[...]`/`sys.path`, thêm 1 vào chỉ số `parents[N]` (đọc từng file; ví dụ `parents[1]` → `parents[2]`) để chạy được từ vị trí mới; chạy `python backend/scripts/archive/<f> --help` (hoặc `python -c "import ast,sys; ast.parse(open(sys.argv[1]).read())" <f>` nếu script không có `--help` và sẽ kết nối DB) — **không chạy thật** script nào kết nối DB.
- **Đầu ra:** 1 PR.
- **Nghiệm thu:** lệnh kiểm ở "Đầu vào" chạy lại trên staging mới nhất → rỗng trước khi xoá; `cd backend && python -m pytest tests/ -q` qua (86 test file nhắc `scripts/` — phải không vỡ); `ls backend/scripts/_script_env.py` → còn.
- **Không làm:** không đụng `_script_env.py` và mọi script được nhắc tên; không chạy script.
- **Vướng mắc → cách gỡ:** `regrade_listening_attempts.py` là công cụ chấm lại (nhóm high-risk khi chạy) → nếu anh Andy muốn giữ để dùng khi có sự cố, loại nó khỏi danh sách; mặc định giữ lại file này (không xoá) và ghi trong PR.
- **Ước lượng:** 1 phiên · độ khó 2.

### G01-T13 — Bỏ dây chuyền Tailwind thứ hai (1.9)

- **Mục đích:** bớt một build CSS và một guard CI không phục vụ trang nào.
- **Đầu vào:** `frontend/package.json` dòng 11–13, `frontend/tailwind.config.inter.cjs`, `.github/workflows/backend-tests.yml` dòng 537–552, `frontend/tests/hex-budget.test.mjs:43`, `frontend/tests/primitive-families.test.mjs:31`, `docs/SUPABASE_REGION_MIGRATION.md:231`.
- **Việc làm:**
  1. Chứng minh không ai nạp: `git grep -n "tailwind.inter" -- frontend/app frontend/components frontend/lib frontend/public frontend/tests/fixtures frontend/tests/e2e` → rỗng. Bước runtime: trên staging, mở 5 trang (`/login`, `/home`, `/practice`, `/admin`, `/grammar`) với DevTools tab Network lọc `tailwind.inter` → không có request; ghi vào PR. (Không đăng nhập production.)
  2. `package.json`: `"build:css": "npm run build:css:plusjakarta"`; xoá `build:css:inter`.
  3. `git rm frontend/tailwind.config.inter.cjs frontend/public/css/tailwind.inter.css`.
  4. `backend-tests.yml:552`: xoá dòng `check ./tailwind.config.inter.cjs css/tailwind.inter.css`; sửa tên bước (dòng 538) bỏ chữ "all clusters" nếu muốn — **không đổi tên job**.
  5. `hex-budget.test.mjs:43` và `primitive-families.test.mjs:31`: bỏ `'tailwind.inter.css'` khỏi danh sách miễn (file không còn, phần tử thừa vô hại nhưng gây hiểu lầm). Đây là sửa test có chủ ý: ghi trong PR.
  6. `docs/SUPABASE_REGION_MIGRATION.md:231`: sửa chú thích lệnh.
- **Đầu ra:** 1 PR.
- **Nghiệm thu:** `cd frontend && npm run build:css:setup && npm run build:css && git diff --exit-code public/css/tailwind.build.css` → exit 0; `node --import … --test frontend/tests/hex-budget.test.mjs frontend/tests/primitive-families.test.mjs frontend/tests/workflow-path-coverage.test.mjs frontend/tests/workflow-post-merge-gates.test.mjs` qua; CI job `frontend` (trong `backend-tests.yml`) xanh; BỘ KIỂM ĐẦY ĐỦ qua.
- **Không làm:** không đổi `tailwind.config.cjs`, `tailwind.src.css`, `tailwind.build.css`.
- **Vướng mắc → cách gỡ:**
  - `frontend/css` là symlink tới `public/css` (Gate F audit nêu); script build chạy với đường dẫn `./css/...` → giữ nguyên, chỉ xoá đầu ra inter.
  - 10 test đọc `backend-tests.yml` (`git grep -l backend-tests.yml -- frontend/tests backend/tests`) → chạy cả 10 trước khi đẩy; nếu một test ghim chuỗi `tailwind.config.inter.cjs`, sửa test đó trong cùng PR và liệt kê.
  - G03 đang sửa build CSS cùng lúc → không làm song song; phiên sau rebase.
- **Ước lượng:** 1 phiên · độ khó 2.

### G01-T14 — Gộp phần trùng `AGENTS.md` ↔ `CLAUDE.md` (1.10)

- **Mục đích:** mỗi quy tắc có một bản; bớt khoảng 80–100 dòng mỗi phiên agent phải đọc.
- **Đầu vào:** `AGENTS.md`, `CLAUDE.md`, `docs/AGENT_WORKFLOW.md` mục "Read order", `frontend/tests/staging-first-release-flow.test.mjs:18,114-115`, `backend/tests/test_speaking_schema_contract.py:40-50` (chỉ chú thích nhắc "CLAUDE.md schema reference block").
- **Việc làm:**
  1. Lập bảng (trong thân PR) từng mục trùng: tiêu đề ở `AGENTS.md` · tiêu đề ở `CLAUDE.md` · chỗ khác nhau về nội dung. Mục trùng tối thiểu: Grammar Wiki; feedback quality (`_QUOTE_RE`, trích nhóm); quyền mã kích hoạt admin; staging-first release flow.
  2. Chỗ hai bản **khác nhau về nội dung** → không tự chọn; giữ cả hai ý ở `AGENTS.md` và ghi "CẦN ANH ANDY QUYẾT" trong PR.
  3. `AGENTS.md` giữ bản đầy đủ. `CLAUDE.md`: thay mỗi mục trùng bằng một dòng "See `AGENTS.md` › <tiêu đề>"; giữ nguyên các phần chỉ có ở `CLAUDE.md`: "File structure", "Routing rule", "Backend routes", "Config / environment", "Frontend state machine", "Skills", "Known limitations", "Definition of Done", và khối tham chiếu schema (vì `test_speaking_schema_contract.py` nhắc nó). Thêm ở đầu `CLAUDE.md` dòng `@AGENTS.md` (cú pháp import của Claude Code) để Claude tự nạp `AGENTS.md`.
  4. `docs/AGENT_WORKFLOW.md` "Read order": ghi rõ `CLAUDE.md` chỉ chứa phần điều hướng mã.
- **Đầu ra:** 1 PR, 2–3 file.
- **Nghiệm thu:** `grep -c "" CLAUDE.md` giảm ít nhất 60 dòng; `grep -n "PR base is \`staging\`, never \`main\`\|head \`staging\` and base \`main\`" AGENTS.md` → 2 dòng; `node --import … --test frontend/tests/staging-first-release-flow.test.mjs frontend/tests/vercel-ignore-build.test.mjs frontend/tests/workflow-path-coverage.test.mjs` qua; `cd backend && python -m pytest tests/test_install_agent_config.py tests/test_speaking_schema_contract.py -q` qua.
- **Không làm:** không đổi quy tắc nào (chỉ dời/gộp chữ); không sửa `frontend/AGENTS.md` (Next tự sinh lại khối `nextjs-agent-rules`); không sửa `backend/scripts/agent-config/shared/*`.
- **Vướng mắc → cách gỡ:**
  - Codex/agent khác không hiểu `@AGENTS.md` → vô hại (dòng chữ thường); vẫn có dòng chữ "Read AGENTS.md first".
  - Review đòi giữ bản tiếng Việt/Anh khác nhau → giữ ngôn ngữ của `AGENTS.md`.
- **Ước lượng:** 1 phiên · độ khó 3.

### G01-T15 — SQL release Reading 30 MiB (1.12) — theo Q5

- **Mục đích:** bớt khoảng 30 MiB file sinh ra khỏi cây.
- **Đầu vào:** 10 file `backend/content/reading-practice/**/release/*.sql`, các `release/manifest.json`, `backend/content/reading-practice/expansion-20261015/README.md`, `prepare_release.py`.
- **Việc làm (chỉ khi Q5 xác nhận cả staging và production đã áp dụng và không cần rollback từ file):**
  1. Kiểm manifest: nếu `manifest.json` ghim SHA của file SQL, giữ manifest và ghi chú "SQL regenerated by `prepare_release.py --out <dir>`".
  2. `git rm` các file `*-apply.sql`; **giữ** `*-rollback.sql` trừ khi Q5 nói bỏ cả rollback.
  3. Thêm `backend/content/reading-practice/**/release/*-apply.sql` vào `.gitignore`.
- **Đầu ra:** 1 PR.
- **Nghiệm thu:** `python backend/content/reading-practice/expansion-20261015/prepare_release.py --out /tmp/rp-check` (không kết nối DB — docstring dòng 1 ghi "Offline; never connects to a DB") tái tạo file; `diff` với bản đã xoá (`git show HEAD~1:<path>`) → giống; `cd backend && python -m pytest tests/test_reading_expansion_authoring.py -q` qua.
- **Không làm:** không chạy SQL; không xoá manifest.
- **Vướng mắc → cách gỡ:** file sinh lại khác byte (thời gian trong header) → so sau khi bỏ dòng chú thích thời gian; nếu khác nội dung, dừng, không xoá, báo.
- **Ước lượng:** 1 phiên · độ khó 2.

### Bảng ước lượng tổng

| Nhiệm vụ | Pha | PR | Phiên | Độ khó | Chờ quyết định |
| --- | --- | ---: | ---: | ---: | --- |
| T01 chỉ mục docs, mốc bảo trì | 0 | 1 | 1 | 1 | Q6 (có mặc định) |
| T02 sổ spec | 0 | 1 | 1 | 2 | — |
| T03 hướng dẫn mâu thuẫn, SITE_OVERVIEW | 0 | 1 | 1 | 1 | Q7 (có mặc định) |
| T04 xoá 2 file rác | 0 | 1 | 1 | 1 | — |
| T05 README + `config:reset` | 0/1 | 1 | 1 | 1 | — |
| T06 sổ số migration | 1 | 1 | 2 | 3 | Q8 (có mặc định) |
| T07 dời docs vào `docs/history/` | 1 | 1 | 1 | 2 | Q1 |
| T08 dời file gốc lịch sử | 1 | 1 | 1 | 2 | Q1 |
| T09 `TECH_DEBT.md` | 1 | 1 | 1 | 1 | Q2 |
| T10 đầu ra `MAPPING_*` | 1 | 1 | 1 | 1 | — |
| T11 `source_material/`, `commission/` | 1 | 1 | 1 | 1 | Q3 |
| T12 16 script một lần | 1 | 1 | 1 | 2 | Q4 |
| T13 bỏ Tailwind inter | 1 | 1 | 1 | 2 | — |
| T14 gộp `AGENTS.md`/`CLAUDE.md` | 1 | 1 | 1 | 3 | — |
| T15 SQL release Reading | 1 | 1 | 1 | 2 | Q5 |
| **Tổng** | | **15** | **16** | | |

## 7. Vướng mắc chung của gói và cách tháo gỡ

| Tình huống | Dấu hiệu nhận biết | Cách gỡ | Khi nào dừng và hỏi |
| --- | --- | --- | --- |
| Test đọc file theo tên/chuỗi vỡ sau khi dời | `ENOENT` hoặc `AssertionError` chứa đường dẫn cũ trong test `frontend/tests/*.test.mjs` hoặc `backend/tests/test_*.py` | Lệnh 5.2 lẽ ra đã bắt; mở test, nếu test chỉ ghim đường dẫn file lịch sử thì **bỏ file đó khỏi danh sách dời** (không sửa test) | Nếu hơn 3 test vỡ trong một PR |
| Loader fixture vá `fs` | Test `pages/...` lỗi lạ sau khi dời gì đó trong `frontend/` | `frontend/tests/fixtures/legacy-html-retired/loader.mjs` vá `fs.readFileSync/existsSync/realpathSync`; luôn chạy bộ contract với `--import` loader như 5.1 | — |
| Bộ lọc đường dẫn CI bỏ sót | Job bắt buộc báo "skipped" mà PR có đổi code | `backend-tests.yml` và `next-native-browser.yml` có job `changes`; skip = đạt. Với PR chạm `.py`/`.yml`, đọc log job `changes` xem có phân loại đúng không | Khi job bắt buộc "skipped" trên PR có đổi `.py` |
| Bản sao nông | `git log` chỉ một commit | `git fetch --unshallow` | — |
| PR khác đang sửa cùng file | Xung đột khi rebase `docs/README.md`, `backend/migrations/README.md`, `package.json` | Theo 00 §7: nhiệm vụ đứng trước làm trước; phiên sau rebase, giữ cả hai thay đổi | Xung đột trong câu bị test ghim |
| Thay đổi chỉ tài liệu bị CI chạy nặng | 18 job chạy | Bình thường; không thêm `[skip ci]` | — |

## 8. Ràng buộc riêng của gói

1. Mỗi nhiệm vụ một PR; không gộp hai nhiệm vụ vì "cùng là tài liệu".
2. Không sửa nội dung file lịch sử ngoài link tương đối bị vỡ do dời.
3. Không sửa bất kỳ file `.sql` nào trong `backend/migrations/` (kể cả chú thích).
4. Không thêm test đọc mã nguồn so chuỗi. Test mới duy nhất của gói (`test_migration_register.py`) so tên file với dữ liệu sổ.
5. T07, T08, T09, T11, T12, T15 không bắt đầu khi chưa có câu trả lời Q tương ứng; trong lúc chờ làm nhiệm vụ khác.
6. Không tạo file chuyển hướng/symlink ở đường dẫn cũ.

## 9. Kiểm thử và bằng chứng hoàn tất của cả gói

- **Kịch bản 1 — tìm tài liệu hiện hành.** Given một agent mới chỉ đọc `docs/README.md`, When nó cần quy trình migration, Then link dẫn tới file có nội dung (`backend/migrations/README.md` + `register.tsv`), không tới file rỗng.
- **Kịch bản 2 — sổ spec đủ.** Given 55 thư mục spec, When chạy vòng lặp kiểm ở T02, Then không in `THIEU`; `validate_specs.py` 0 lỗi.
- **Kịch bản 3 — số migration.** Given hai phiên thực thi cùng cần migration, When phiên A thêm hàng `reserved 381 G04-T03` và phiên B thêm `reserved 381 G09-T05`, Then PR merge sau bị xung đột ở `register.tsv` (cùng dòng) hoặc test register báo trùng số → phiên B lấy số kế tiếp.
- **Kịch bản 4 — gốc repo gọn (nếu Q1 = có).** Given staging sau G01, When `ls` gốc repo, Then chỉ còn `AGENTS.md CLAUDE.md README.md TECH_DEBT.md PHASE_CLOSURE_LEDGER.md .gitignore .python-version` và các thư mục `backend docs frontend loadtest scripts specs data .github`.
- **Kịch bản 5 — không đổi hành vi.** Given staging sau mọi PR của gói, When chạy BỘ KIỂM ĐẦY ĐỦ và CI `Tests`, `Typecheck`, `Spec governance`, `Next-native browser regression`, Then xanh; `git diff <sha-trước-G01>..HEAD --stat -- frontend/app frontend/components frontend/lib backend/routers backend/services backend/migrations` chỉ có thay đổi chú thích (T08).
- **Môi trường:** local + CI của PR + staging (T13 bước kiểm Network). Không thao tác gì trên production.

## 10. Cần anh Andy quyết

| # | Câu hỏi | Phương án đề nghị | Mặc định tạm nếu chưa trả lời |
| --- | --- | --- | --- |
| Q1 | **ĐÃ TRẢ LỜI 17/11 (00 mục 2 điểm 20):** nới thành "giữ khi còn được tham chiếu" — dùng câu tiếng Anh ở T08 bước 5: "Historical files stay at a stable path while anything in this repository links to them; unreferenced historical files may move to `docs/history/` with an index row". (Hệ quả đã biết: link từ PR/issue cũ trên GitHub tới khoảng 42 file sẽ 404; lịch sử Git vẫn còn.) | — | T07, T08 làm |
| Q2 | Backlog chính thức là gì: `specs/`, `TECH_DEBT.md` hay `docs/phase_b_backlog.md`? | `specs/` là duy nhất; `TECH_DEBT.md` đóng băng làm lịch sử | T09 không làm |
| Q3 | `source_material/` (2 app Vite mẫu) và `commission/` (ghi chú Sprint 14): xoá hay dời `docs/history/`? | Xoá `source_material/`, dời `commission/` | T11 không làm |
| Q4 | 16 script không ai gọi: xoá (Git giữ) hay dời `backend/scripts/archive/`? Có giữ `regrade_listening_attempts.py` không? | Xoá 15, giữ `regrade_listening_attempts.py` tại chỗ | T12 không làm |
| Q5 | SQL release Reading (`core-quality-20261015`, `expansion-20261015`, `quality-20261015`) đã áp dụng ở cả staging và production chưa; còn cần file rollback trong repo không? | Bỏ file `*-apply.sql`, giữ rollback | T15 không làm |
| Q6 | `docs/data-models.md` rỗng: viết trang mô hình dữ liệu hay trỏ lại về `backend/migrations/README.md`? | Trỏ lại, xoá file rỗng (G04 sẽ mô tả bảng mới trong spec của nó) | Trỏ lại |
| Q7 | **ĐÃ TRẢ LỜI (01 mục 7.1 câu 3):** nhánh `codex/<ten-nhiem-vu>`; T03 bước 2 dùng câu "a scoped topic branch (`codex/<task>`; use `preview/<slug>` only to request a Vercel preview)" | — | Như câu trả lời |
| Q8 | Các số migration giữ chỗ không có chủ rõ (lỗ 160, 164, 327–330, 342, 348–350, 354, 370–375): giải phóng hay giữ? | Đánh `abandoned` những số có owner là PR đã đóng; giữ `reserved` số của PR còn mở | Ghi `reserved` + `unknown-ask-owner` |
