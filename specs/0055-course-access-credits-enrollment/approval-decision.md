# Approved intent decision

**State: APPROVED by direct human owner reply.** Andy (repository owner, the
only operator of this repository; "Leader" in `backend/migrations/README.md`)
approved this spec on **2026-11-20**, in two records from his own account in the
"Code - Averlearning.com" Claude Project:

1. **11:04:20 (Asia/Saigon, UTC+7)**, decision card in the G04 thread, option
   chosen: "Duyệt spec 0055" on the question "Duyệt spec 0055 (khoá học, quyền,
   lượt AI) để bắt đầu code G04?".
2. **11:04:45 (Asia/Saigon, UTC+7)**, typed in the project chat, verbatim:
   "duyệt spec 0055, 0056 và 0074 / đồng ý cả 11".

The approved revision is `spec.md`, `plan.md`, `tasks.md`, `rollout.md`,
`ui-states.md` and `verification.md` as on `staging` at `c0a04fd6` (after
#2335 and #2378). No requirement text is changed by this record.

## What the approval covers

- The intent in `spec.md` (every FR not marked **ĐÃ BỎ**), the contracts in
  `plan.md`, the task order in `tasks.md` and the rollout in `rollout.md`.
- "đồng ý cả 11": the open questions at the end of
  `docs/proposals/commercialization-2026-11/04-VIEC-DE-LAI.md` are answered
  with the temporary defaults written there. Where this spec applied a default
  "chờ anh Andy xác nhận", that default is now the decision.
- Decisions Andy had already taken on 2026-11-18 and that the spec text asked
  to record here at approval:
  - **Q13 (step-up MFA):** no MFA to confirm an order. Step-up MFA
    (`CONDITIONAL_STEP_UP_ROUTES`) applies exactly as the Q13 row of `spec.md`
    and `plan.md` 5.9 state it, i.e. on all four conditions:
    `POST /admin/entitlements` when `credits` is omitted/null or `credits > 50`;
    `POST /admin/credits/adjust` when `abs(delta) > 50`;
    `POST /admin/credits/grant-extra` when `cohort_id` is set or the total
    `credits * len(user_ids or [1])` is above 50;
    `POST /admin/credits/convert-class` when `credits_per_member > 0`.
  - **C2 (FR-052, account deletion):** deletion anonymises the account and
    keeps orders and the credit ledger linked to the anonymised id; order
    documents and the ledger are kept **10 years**.
  - **N-3 (re-grade inside a covered Speaking cluster):** at most **1** free
    re-grade per question (`CREDIT_CLUSTER_FREE_REGRADES = 1`), then 1 credit
    per further grading.

## Migration numbers

The spec labels M1…M7 as 381–385, 387, 388. 381/382 stay reserved for
FU-2281, so Andy assigned the real numbers on 2026-11-20 11:04:29
(Asia/Saigon), decision card in the G04 thread, option "Theo đề xuất
383–389, 502":

| Spec label | Content | Task | Real number |
| --- | --- | --- | --- |
| 381 (M1) | products, entitlements, codes, orders, outbox | G04-T01 | **383** |
| 382 (M2) | credit ledger, reservations, RPCs | G04-T02 | **384** |
| 383 | credit lifecycle (expire, carry-over, grant extra) | G04-T12 | **385** |
| 388 | convert legacy class to metering | G04-T15 | **387** |
| 384 | one session per learner account | G04-T09 | **388** |
| 387 | recent sign-ins | G04-T16 | **389** |
| 385 | pronunciation sample window | G04-T13 | **502** |

386 stays empty. Where the spec or plan still calls 389 the package's spare
number (for the 381/382 overflow), this table supersedes it: 389 is G04-T16. Each migration PR adds its own `register.tsv` row; the
first one (G04-T01) reserves all seven. The order of application keeps the
rule that a lower number never depends on a higher one.

## What it does not authorize

It authorizes implementation PRs to `staging` only. It does not authorize
applying any migration to any database, turning on any feature flag
(`credit_metering`, `enrollment_orders`, `single_session_learners`,
`retention_by_entitlement`, `pron_sample_window`), changing env on Railway or
Vercel, or any production action. Each of those needs Andy's own typed
approval at the time. Migrations 376–379 are never applied under this spec.
