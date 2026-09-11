## Release target

- [ ] Normal feature/fix/content PR: base branch is `staging`.
- [ ] Production promotion PR: head is `staging`, base is `main`, and the exact staging SHA has passed Staging E2E.

## Verification

- [ ] Tests for the changed layers are green.
- [ ] User-visible behavior was checked on the Vercel Preview or stable staging URL.
- [ ] Database changes, if any, were applied and verified on staging before production.
- [ ] Inline review comments are resolved.

## Risk and rollback

Describe the affected flows, persisted data, migration ordering and rollback path.
