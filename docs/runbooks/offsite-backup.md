# Offsite backup and restore drill

Closes DR tabletop gaps 1 and 4 (2026-10-27): PITR is off on both projects,
Supabase's own backups live inside the same account (deleting the project
deletes them), and Storage bytes had no copy at all. Approved by Vinh on
2026-10-27: weekly off-Supabase backup of the database **and** Storage objects,
plus a monthly restore drill. No PITR.

| Piece | File |
|---|---|
| Weekly backup workflow | `.github/workflows/offsite-backup.yml` |
| Monthly restore drill workflow | `.github/workflows/offsite-restore-drill.yml` |
| PR self-test (local services, no secrets) | `.github/workflows/offsite-backup-selftest.yml` |
| Scripts | `scripts/backup/` (`offsite_backup.sh`, `restore_drill.sh`, `storage_tool.py`, `bundle_tools.py`) |

Every production step, including enabling the production job, reading a
production backup and restoring one, needs Vinh's approval ("cần anh Vinh
duyệt"). Never print or paste secrets, connection strings, signed URLs or
learner data. The repository is **public**, so workflow logs and job summaries
are public too. The scripts log only aggregate counts and schema-level names,
and the bundle is never uploaded as a workflow artifact.

## What a backup contains

Each run produces one age-encrypted tar, streamed straight to the destination:

```
<env>/<tier>/<YYYYmmddTHHMMSSZ>-<run id>/bundle.tar.age   encrypted bundle
<env>/<tier>/<YYYYmmddTHHMMSSZ>-<run id>/meta.json        written last = "complete"
```

Inside `bundle.tar.age`:

| Path | Content |
|---|---|
| `manifest.json` | env, project ref, timestamps, server/pg_dump versions, sizes, Storage totals |
| `db/full.dump` | `pg_dump --format=custom` of the whole database (all schemas the `postgres` role can read: public, auth, storage, realtime, vault, extensions), schema + data, owners and ACLs |
| `db/roles.sql` | `pg_dumpall --roles-only --no-role-passwords` |
| `db/toc.txt`, `db/rowcounts.tsv` | dump table of contents; exact rows per table **as written in the dump** |
| `storage/buckets.json` | every bucket's id, public flag, size limit, MIME allow-list |
| `storage/objects.jsonl` | every object: bucket, name, size, sha256, content type, cache control, timestamps |
| `storage/objects/<bucket>/<name>` | the bytes |

`meta.json` is unencrypted and holds no data: key, sha256 and size of the
bundle, env, project ref, timestamps, git SHA and short fingerprints of the
recipients. The drill only considers backups that have a `meta.json`, so an
upload that died half-way is never picked.

The DB is dumped first, then Storage is listed and downloaded. Objects created
or deleted in between appear as a small drift, which the drill tolerates
(max(10, 0.5 %) objects). An object that is listed but cannot be downloaded
while it is still listed fails the backup.

Staging, measured 2026-10-27: DB 160 MB (149 public tables, 27 auth, 8
storage); Storage 6 buckets, 8,317 objects, 6.40 GB (listening-audio 6.32 GB).
A read-only export of the five smaller buckets plus a listing of
listening-audio matched `storage.objects` exactly (names, counts, bytes).
Production sizes were not read (no production access for this task).

## Encryption and keys

The bundle is encrypted with [age](https://age-encryption.org) to **public**
recipients only (`BACKUP_AGE_RECIPIENTS`). GitHub never holds the master
private key.

| Key | Private key lives | Public key goes in |
|---|---|---|
| **Master** (required) | Offline only: Vinh's password manager plus a printed or USB copy in a safe. Never in GitHub. | `BACKUP_AGE_RECIPIENTS` of **both** backup environments |
| Second offline key (recommended) | A second trusted person, offline (bus factor) | Both, same as master |
| **Staging drill key** | GitHub secret `DRILL_AGE_IDENTITY` in `offsite-drill-staging` | `BACKUP_AGE_RECIPIENTS` of `offsite-backup-staging` **only** |

Why a staging drill key is in GitHub: the monthly CI drill must decrypt. The
key opens staging backups only. Anyone who can read GitHub environment secrets
can already read the staging database and Storage live through
`BACKUP_DATABASE_URL` and `BACKUP_SUPABASE_SERVICE_KEY`, so the drill key adds
little exposure. Production backups are encrypted to offline keys only, so the
production drill runs on a trusted machine (see
[Production drill](#production-drill-local-monthly)). The workflows pin each
environment's project ref and the scripts refuse mismatched credentials, so a
staging job cannot be pointed at production data.

Generate keys on a trusted machine, not in CI and not on a shared box:

```bash
age-keygen -o aver-backup-master.key        # prints "Public key: age1..."
age-keygen -o aver-backup-staging-drill.key
age-keygen -y aver-backup-master.key        # print a public key again
```

**Losing every private key makes every backup unreadable.** Test that the
master key decrypts (production drill below) before relying on it.

## Destination: Cloudflare R2 (recommended)

Any S3-compatible store works (the destination is pluggable through the
`OFFSITE_S3_*` secrets). R2 is recommended because it has no egress fees
(the drill downloads a full bundle every month), a 10 GB-month free tier, bucket
locks and lifecycle rules. Backblaze B2 is a cheaper-per-GB alternative,
configured the same way.

Use a **separate Cloudflare account** (or at least a separate account owner)
from anything that holds Supabase or GitHub admin access. Then one compromised
control plane cannot delete both the data and its copies.

1. Create a private bucket, e.g. `aver-offsite-backups`. Keep public access off.
2. **Lifecycle rules** (bucket → Settings → Object lifecycle rules), delete
   objects after:

   | Prefix | Delete after | Keeps |
   |---|---|---|
   | `staging/weekly/` | 35 days | ~4 weekly |
   | `staging/monthly/` | 90 days | 3 monthly |
   | `production/weekly/` | 35 days | ~4 weekly |
   | `production/monthly/` | 180 days | 6 monthly |
   | `staging/manual/`, `production/manual/` | 14 days | ad-hoc runs |

3. **Bucket lock rules** (bucket → Settings → Bucket lock rules): lock
   `staging/` and `production/` for **28 days**. A leaked writer token then
   cannot delete or overwrite recent backups. Keep the lock shorter than the
   lifecycle ages so expiry still works.
4. **API tokens** (R2 → Manage API tokens), each scoped to this bucket only:
   - writer: *Object Read & Write*, used by the `offsite-backup-*` environments;
   - reader: *Object Read only*, used by the `offsite-drill-*` environments.
5. Endpoint: `https://<CLOUDFLARE_ACCOUNT_ID>.r2.cloudflarestorage.com`;
   region `auto` (the default; no variable needed).

Backblaze B2 instead: endpoint `https://s3.<region>.backblazeb2.com`, set the
`OFFSITE_S3_REGION` variable to the bucket region (e.g. `us-west-004`). Writer
application key capabilities: `listBuckets, listFiles, readFiles, writeFiles`
(no `deleteFiles`). Reader key: `listFiles, readFiles`. Enable Object Lock and
use lifecycle rules with the same ages.

## Setup: exactly what to create in GitHub

Names only. Set values with `gh secret set NAME --env ENV` (it prompts and does
not echo) or the GitHub UI. Never paste values into chat, issues or PRs.

### Environments

Create four environments (Settings → Environments). For each one set
**Deployment branches and tags → Selected branches → `main`**. Then only the
reviewed workflow on `main` can read the secrets, and a pushed branch cannot
dispatch a modified workflow against them. Do not add required reviewers:
scheduled runs would wait forever.

#### `offsite-backup-staging`

| Kind | Name | Value |
|---|---|---|
| secret | `BACKUP_DATABASE_URL` | staging **Session pooler** URI from Supabase → Connect (port **5432**, user `postgres.zjphffoujxkpltixsbzj`, URL-encoded password, append `?sslmode=require`). Not the transaction pooler (6543), and not `db.<ref>.supabase.co` (IPv6-only; GitHub runners are IPv4). |
| secret | `BACKUP_SUPABASE_SERVICE_KEY` | staging secret key. Create a dedicated `sb_secret_…` key named `offsite-backup` (Settings → API Keys) so it can be revoked alone; the legacy service_role JWT also works |
| secret | `OFFSITE_S3_ENDPOINT` | R2 endpoint URL |
| secret | `OFFSITE_S3_BUCKET` | bucket name |
| secret | `OFFSITE_S3_ACCESS_KEY_ID` | **writer** token access key id |
| secret | `OFFSITE_S3_SECRET_ACCESS_KEY` | **writer** token secret |
| variable | `BACKUP_AGE_RECIPIENTS` | master public key, second offline public key (optional), **staging drill** public key, one per line |
| variable | `OFFSITE_S3_REGION` | optional; only for B2/AWS (default `auto`) |

#### `offsite-drill-staging`

| Kind | Name | Value |
|---|---|---|
| secret | `DRILL_AGE_IDENTITY` | full content of `aver-backup-staging-drill.key` (the `AGE-SECRET-KEY-1…` line) |
| secret | `OFFSITE_S3_ENDPOINT`, `OFFSITE_S3_BUCKET` | same as above |
| secret | `OFFSITE_S3_ACCESS_KEY_ID`, `OFFSITE_S3_SECRET_ACCESS_KEY` | **reader** token |
| variable | `OFFSITE_S3_REGION` | optional, as above |

#### `offsite-backup-production`

Same names as `offsite-backup-staging`, with production values:
Session pooler URI with user `postgres.huwsmtubwulikhlmcirx`, the production
`offsite-backup` secret key, and the same writer token (or a separate one).
`BACKUP_AGE_RECIPIENTS` must hold **only offline keys** (master plus optional
second), never the staging drill key.

#### `offsite-drill-production` (optional, off by default)

Leave empty unless Vinh decides to let CI decrypt production backups. That
means putting a production-only drill identity in GitHub, which this design
avoids on purpose.

### Repository variables

| Name | Value |
|---|---|
| `OFFSITE_BACKUP_PRODUCTION_ENABLED` | unset now; set to `true` **after** `offsite-backup-production` is complete. Until then scheduled runs skip production with a notice, and a manual production dispatch fails with an explicit error. |
| `OFFSITE_DRILL_PRODUCTION_ENABLED` | leave unset (see above) |

### First run (after the PR reaches `main`)

Scheduled workflows and the "Run workflow" button only work once the workflow
files are on the default branch (`main`), so they go live with the next
staging → main promotion. Until the staging secrets exist, the weekly staging
job fails with `missing configuration: <names>` on purpose; a missing backup
must not look green.

1. Actions → **Offsite backup** → Run workflow → `staging`, tier `manual`.
   The job summary shows the destination key, sizes and timings.
2. Actions → **Offsite restore drill** → Run workflow → `staging`. It must end
   with `restore drill passed`; the summary table shows each check.
3. Production: complete `offsite-backup-production`, set
   `OFFSITE_BACKUP_PRODUCTION_ENABLED=true`, dispatch **Offsite backup** →
   `production`, then run the [production drill](#production-drill-local-monthly)
   locally with the master key.

## Schedule and retention

| What | When | Notes |
|---|---|---|
| Backup | Sundays 02:17 Vietnam time (`17 19 * * 6` UTC) | The first run of each month (day ≤ 7) goes to `monthly/`, the rest to `weekly/` |
| Restore drill (staging, CI) | 9th of each month, 03:23 UTC | Uses the newest complete backup, usually that month's `monthly/` |
| Restore drill (production) | Monthly, manual | Local, with the offline key |

Retention comes from the bucket lifecycle rules above, not from the job, so the
writer token never needs delete rights. Worst-case RPO from this backup is
about 7 days; Supabase's own daily backups remain the first choice for recent
in-place recovery while the project still exists.

Failure signals: a failed backup or drill turns the workflow red, and GitHub
emails the person who last edited the workflow's cron. The drill also fails
when the newest backup is more than 8 days old, so a stalled weekly job is
caught within a month. GitHub disables schedules in a public repository after
60 days without commits; re-enable from the Actions tab if that ever happens.

## What the drill checks

`restore_drill.sh` runs against a disposable Postgres 17 and refuses any URL
containing `supabase.co` / `supabase.com`.

1. Newest `meta.json` belongs to the expected env and project ref, and is at
   most 8 days old (`DRILL_MAX_AGE_DAYS`).
2. Download → sha256 must equal `meta.json`; age decryption authenticates
   every chunk (a flipped byte fails).
3. Every Storage object's size and sha256 match `objects.jsonl`; no extra files.
4. `roles.sql` is replayed. Three Supabase-only shapes are adjusted:
   preload-library settings (`safeupdate`), `ALTER ROLE` of the drill
   superuser, and the `GRANTED BY` grantor on memberships.
5. `pg_restore --exit-on-error` in three passes (pre-data, data, post-data).
   Supabase extensions missing from plain Postgres (today: `supabase_vault`,
   0 secrets on staging) are skipped, together with their config-table data
   and the platform GRANTs on their member objects (staging has such grants on
   `vault.secrets`, `vault.decrypted_secrets` and 3 vault functions). All of
   this is **listed in the summary**. `DRILL_SKIP_EXTENSIONS` forces the same
   treatment for an extension the target does have. Everything else must restore without error, including
   every foreign key, index, RLS policy, trigger and grant.
6. Every table's `count(*)` equals the rows written in the dump.
7. `_schema_migrations` is non-empty (newest filename shown) and `auth.users`
   is non-empty.
8. `storage.objects` rows vs exported bytes differ by at most the tolerance.

The job summary records the time spent fetching and decrypting, restoring, and
checking. That is the measured part of the RTO the tabletop asked for.

## Production drill (local, monthly)

On a trusted machine with Docker, age ≥ 1.1, psql/pg_restore ≥ 17.6, the AWS
CLI and the **reader** token. Cần anh Vinh duyệt.

```bash
docker run -d --name aver-drill -e POSTGRES_USER=drill \
  -e POSTGRES_HOST_AUTH_METHOD=trust -p 127.0.0.1:55432:5432 postgres:17
read -rs OFFSITE_S3_ACCESS_KEY_ID; read -rs OFFSITE_S3_SECRET_ACCESS_KEY
read -r OFFSITE_S3_ENDPOINT; read -r OFFSITE_S3_BUCKET
export OFFSITE_S3_ACCESS_KEY_ID OFFSITE_S3_SECRET_ACCESS_KEY OFFSITE_S3_ENDPOINT OFFSITE_S3_BUCKET
DRILL_ENV=production DRILL_EXPECTED_REF=huwsmtubwulikhlmcirx \
DRILL_TARGET_URL=postgres://drill@127.0.0.1:55432/postgres \
DRILL_AGE_IDENTITY_FILE=/path/to/aver-backup-master.key \
  bash scripts/backup/restore_drill.sh
docker rm -f aver-drill
```

The same command with `DRILL_ENV=staging DRILL_EXPECTED_REF=zjphffoujxkpltixsbzj`
drills staging locally. `OFFSITE_DEST_KIND=file OFFSITE_FILE_ROOT=<dir>` reads
a downloaded copy instead of the bucket.

## Restore procedure (real incident)

Follow the DR tabletop order first: contain the incident, revoke compromised
credentials, and choose a **clean** point in time. The newest backup is not
necessarily clean.

1. **Pick and fetch a backup.** List `<env>/weekly/`, `<env>/monthly/`. Run the
   drill steps above with `DRILL_BACKUP_KEY=<env>/<tier>/<stamp>-<run>/meta.json`
   to prove that backup restores, then unpack it on the trusted machine:

   ```bash
   aws --endpoint-url "$OFFSITE_S3_ENDPOINT" s3 cp \
     "s3://$OFFSITE_S3_BUCKET/<env>/<tier>/<stamp>-<run>/bundle.tar.age" - \
     | age -d -i /path/to/aver-backup-master.key | tar -C ./restore -xf -
   sha256sum ./restore/db/full.dump   # equals manifest.json db.dump_sha256
   ```

2. **Database into a new Supabase project.** (Not yet rehearsed; rehearse it
   on a scratch project before an incident.) The new project already contains
   Supabase's roles and the auth, storage and realtime schemas. Restore only
   what the app owns, as `postgres` over the new project's session pooler:

   ```bash
   # custom roles only (e.g. read_only); Supabase-reserved roles already exist
   grep -E '^(CREATE|ALTER) ROLE "?read_only"?' restore/db/roles.sql | psql "$NEW_DB_URL"
   # app schema: tables, functions, RLS policies, grants, data
   pg_restore --dbname="$NEW_DB_URL" --no-owner --schema=public --exit-on-error restore/db/full.dump
   # auth + storage rows (not their DDL or migration ledgers)
   pg_restore --list restore/db/full.dump \
     | grep -E 'TABLE DATA (auth|storage) ' \
     | grep -v -E 'TABLE DATA (auth schema_migrations|storage migrations) ' > data.list
   PGOPTIONS='-c session_replication_role=replica' \
     pg_restore --dbname="$NEW_DB_URL" --data-only --use-list=data.list restore/db/full.dump
   ```

   If the new project's auth or storage schema is a newer version than the
   backup, compare columns before loading. Then re-apply any repo migrations
   newer than the newest `_schema_migrations` filename shown by the drill.
3. **Storage into the target project** (creates missing buckets with the saved
   public flag, size limit and MIME list; re-downloads each object to verify
   its sha256):

   ```bash
   read -rs SUPABASE_SERVICE_KEY; export SUPABASE_SERVICE_KEY
   python3 scripts/backup/storage_tool.py restore --supabase-url https://<ref>.supabase.co \
     --from ./restore/storage --confirm-target-ref <ref> --dry-run
   # then without --dry-run; add --upsert to overwrite existing objects,
   # --bucket <id> (repeatable) to restore selected buckets only
   ```

4. **Verify before reopening writes** (tabletop step 5): session → response →
   score aggregates, full-test finalization, drafts, access-code redemption,
   auth logins, and that recording/image paths resolve to restored objects.
   Restore never makes a private bucket public.
5. **Wipe** the decrypted `./restore` directory when done.

## Cost estimate (monthly)

Assumptions: one bundle is about 6.5 GB per environment (staging measured;
production assumed similar, mostly the same listening audio plus learner
recordings). With the retention above, about 8 bundles are kept for staging
and about 11 for production, so roughly 52 GB + 72 GB = **~125 GB stored**.

| Item | Cloudflare R2 | Backblaze B2 |
|---|---|---|
| Storage ~125 GB | (125 − 10 free) × $0.015 ≈ **$1.75** | 125 × ~$0.007 ≈ **$0.90** |
| Writes (~2 backups/week × ~800 multipart parts) | ~7k Class A ops, inside the free 1M → $0 | $0 |
| Drill download (~6.5 GB/month) | $0 (no egress fees) | $0 (free up to 3× stored) |
| GitHub Actions | $0 (public repository, standard runners) | $0 |
| **Total** | **≈ $2 / month** | **≈ $1 / month** |

Supabase side: each backup downloads all Storage bytes once, so about
6.5 GB × 4.3 runs × 2 environments ≈ **56 GB egress per month**. That is $0
while the organization stays inside its plan's included egress (250 GB on Pro).
Above the quota it costs about $0.09/GB, at most about $5/month. The current
plan and usage were not checked (the tabletop's organization/entitlement reads
returned 403). If production Storage grows a lot, cost grows linearly. Check
current provider prices before committing.

## Not covered (by design or yet)

- No PITR (Vinh's decision); RPO up to 7 days for this copy.
- Not backed up: Supabase project configuration (Auth providers, SMTP,
  redirect URLs, API keys), Edge Functions, Vault secrets beyond what `vault`
  exposes to `postgres`, Railway/Vercel environment variables. Keep those in
  the credential store named in the DR plan.
- `auth` passwords are kept as hashes inside `auth.users`. `roles.sql` has no
  role passwords; set new ones on restore.
- The new-Supabase-project database restore (step 2) and Storage restore
  against a real project are documented but have only been exercised against
  local Postgres and a mock Storage API.
