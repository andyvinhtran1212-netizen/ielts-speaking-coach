# Template: Claude Code Execution Prompt

Use khi gửi Claude Code thực thi `PHASE_*_PLAN.md`.

## Header bắt buộc

```
Branch: feature/<descriptive-name>
Base: main (verify trước khi start)
Spec: <PLAN_FILE>.md (authoritative)
```

## Anti-pattern alerts MUST include

```markdown
## Anti-pattern alerts (lessons từ all previous phases)

⚠️ **Cross-file dependency check:**
\```bash
grep -rn "<feature_keyword>" frontend/ backend/
\```
Update TẤT CẢ entry points.

⚠️ **Page template parity:**
Khi tạo HTML page mới, copy init scripts từ reference page.
Run `bash backend/scripts/verify_page_parity.sh` sau khi tạo.

⚠️ **RLS WITH CHECK:**
Mỗi UPDATE policy phải có CẢ USING + WITH CHECK.

⚠️ **Service role chỉ trong admin/background:**
User-facing routes dùng `_user_sb` (RLS-scoped), KHÔNG `supabase_admin`.

⚠️ **Default-deny feature flag:**
Strict `is True` check, exception → False, default OFF.

⚠️ **Migration rollback:**
Comment `-- ROLLBACK SCRIPT (commented):` ở cuối mỗi migration.

⚠️ **Hardcoded URL:**
Frontend dùng `window.api.base`, KHÔNG duplicate fallback logic.

⚠️ **Live test infra day 1:**
Setup script + test skeletons TRƯỚC code feature.
```

## Step-by-step pattern

Yêu cầu Claude Code:
- Commit + push sau mỗi numbered step
- Pause checkpoint sau steps có RLS hoặc cross-phase impact
- Wait user confirm trước khi tiếp

## Verify pre-push

```markdown
\```bash
cd backend
pytest tests/<new_test_files> -v
pytest tests/<regression_test_files> -v
bash scripts/verify_page_parity.sh

# Live RLS (không skip)
set -a; source backend/.env.staging; source backend/.env.staging.test; set +a
pytest tests/<live_test_file> -v
\```

All pass.
```

## Red flags — STOP và hỏi

- Migration conflict với schema hiện có
- Pattern `feature_flags` không support extend
- Schema thiếu field plan reference (verify với Rule 1)
- Performance issue khi query
- Bất kỳ uncertainty
