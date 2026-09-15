## Change metadata

Change class: <!-- hotfix | small | content | feature | high-risk -->
Spec: <!-- N/A or an existing ID such as FEAT-0001 -->

For `feature` and `high-risk`, link a spec that was already approved on the
base branch before implementation began, then list the implemented requirement
IDs. Production promotion PRs from `staging` to `main` are exempt from repeating
feature metadata.

## Problem

<!-- What is wrong or missing? Required when Spec: N/A. -->

## Expected behavior

<!-- What observable behavior should replace it? Required when Spec: N/A. -->

## Scope

<!-- Name the affected flows/files and explicit non-goals. Required when Spec: N/A. -->

## Release target

- [ ] Normal feature/fix/content PR: base branch is `staging`.
- [ ] Production promotion PR: head is `staging`, base is `main`, and the exact staging SHA has passed Staging E2E.

## Verification

<!-- Add concrete test/query/manual evidence below. Required when Spec: N/A. -->

- [ ] Tests for the changed layers are green.
- [ ] Every applicable `FR-NNN` has automated or recorded manual evidence.
- [ ] User-visible behavior was checked on the Vercel Preview or stable staging URL.
- [ ] Database changes, if any, were applied and verified on staging before production.
- [ ] Inline review comments are resolved.

## Risk and rollback

Describe the affected flows, persisted data, migration ordering and rollback path.

## Requirement coverage

List `FR-NNN -> test/query/manual evidence`, or explain why this change uses
`Spec: N/A`.
