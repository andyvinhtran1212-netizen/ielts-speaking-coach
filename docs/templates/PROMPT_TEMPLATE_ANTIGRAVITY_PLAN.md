# Template: Antigravity Plan Prompt

Use khi cần Antigravity tạo `PHASE_*_PLAN.md` cho new feature.

## Rules bắt buộc

### Rule 1: Schema verification BEFORE referencing

**TRƯỚC KHI** reference bất kỳ column/table nào trong plan, BẮT BUỘC verify:

```bash
# Verify column tồn tại
grep -rn "ADD COLUMN.*<column_name>\|<column_name>.*[A-Z]" backend/migrations/

# Verify table tồn tại
grep -rn "CREATE TABLE.*<table_name>" backend/migrations/

# List all columns of a table
grep -A 30 "CREATE TABLE IF NOT EXISTS <table_name>" backend/migrations/*.sql
```

Plan PHẢI có section "Schema verification" liệt kê:
- All tables referenced + migration file
- All columns referenced + migration file
- New tables/columns proposed cần migration mới

### Rule 2: Cross-phase impact assessment

Nếu plan modify table đã ship (Phase B, Wave 1, etc.):
- Liệt kê CRITICAL: ảnh hưởng các phase trước
- Đề xuất regression test plan
- Ghi rõ rollback strategy

### Rule 3: Dependency check existing features

Plan PHẢI có section "Dependency check":
- Phase B vocab bank dependencies
- Wave 1 D1 exercises dependencies
- Wave 2 flashcard dependencies
- External services (Gemini, Whisper, Supabase)

### Rule 4: Migration rollback bắt buộc

Mỗi migration file PHẢI có:
- Comment block `-- ROLLBACK SCRIPT (commented):` ở cuối
- IF NOT EXISTS / IF EXISTS clauses (idempotent)

### Rule 5: RLS policies completeness

Mỗi table mới với RLS:
- SELECT policy với USING
- INSERT policy với WITH CHECK
- UPDATE policy với CẢ USING + WITH CHECK
- DELETE policy với USING

### Rule 6: Test infrastructure day 1

Plan section "Test infrastructure" PHẢI có:
- Setup script `setup_phase_*_test_env.sh`
- Test files skeleton (NOT empty placeholders)
- Live RLS test với 2-JWT pattern (không skip)
- Page parity update if frontend pages added

### Rule 7: Anti-pattern alerts

Plan PHẢI ghi rõ anti-patterns từ Phase B + Wave 1 + Wave 2:
- Fix hẹp: grep TOÀN BỘ entry points
- Service role chỉ trong admin/background
- Default-deny feature flag (strict `is True`)
- Hardcoded URL fallback (dùng `window.api.base`)
- Page template parity

## Plan structure required

Each plan MUST have:

1. Scope confirmation
2. Schema verification (NEW — Rule 1)
3. Dependency check
4. Data model
5. Migration plan với rollback
6. RLS strategy
7. Backend endpoints
8. Frontend plan
9. Feature flag strategy
10. API contract examples
11. Test infrastructure (Rule 6)
12. Step-by-step execution
13. Acceptance criteria
14. Risks + mitigations
15. Cost estimate
16. Deliverables
17. Coding constraints + anti-patterns

## Tone

- Concrete, specific (KHÔNG generic)
- File:line references where possible
- Example code snippets thay vì pseudo-code
- Vietnamese OK cho rationale, English cho technical content
