# Template: Codex Audit Prompt

Use khi gửi Codex audit branch trước merge.

## Audit areas (always include)

1. **Migrations** — schema, RLS, idempotent, rollback
2. **Backend endpoints** — auth, flag, `_user_sb`, rate limit
3. **Frontend** — init scripts, hardcoded URL, page parity
4. **Tests** — coverage, live RLS, mocked correctly
5. **Phase B + Wave 1 + Wave 2 regression** — CRITICAL blocker
6. **Anti-pattern matrix** — all 8+ anti-patterns
7. **DEPLOY_CHECKLIST** — updated with new phase
8. **Cost analysis** — if AI calls involved

## Format output

```markdown
# Audit <Phase> — <Date>

Branch: <branch>
PR: #<num>
Spec: <plan_file>

## Overall verdict
[APPROVE / CONDITIONAL / BLOCK]

## Status matrix
| Area | Status | Notes |

## Findings
### [SEVERITY] - Title
- Location: file:line
- Description, Impact, Reproduction, Suggested fix

## Tests run
- commands + results

## Migration cross-phase concerns (if applicable)

## Merge recommendation
- ✅ APPROVE
- ⚠️ CONDITIONAL (≤2 HIGH)
- ❌ BLOCK (≥1 CRITICAL or regression)
```

## Strict merge bar

- Phase B/Wave 1/Wave 2 regression = blocker
- ≥1 CRITICAL = BLOCK
- ≥3 HIGH = BLOCK
- Live RLS skip = CRITICAL (không acceptable)
- Service role abuse trong user routes = CRITICAL

## Required tests

- All test suites pass locally
- Live RLS không skip
- Migration apply staging idempotent
