# Archive Directory

Holds grammar content removed from active circulation but preserved for
potential future recovery.

## Why archive instead of delete?

Some content was scoped out of the IELTS Speaking product (e.g.
Writing-only grammar) but may become relevant if the product expands
its surface area later.  Drop and merge sources are kept on disk under
this directory rather than deleted outright.

## Layout

```
_archive/
├── README.md                              ← this file
├── ARCHIVE_LOG_<date>.md                  ← per-batch metadata
└── <date>_<batch-name>/                   ← timestamped batch folder
    └── <category>/<slug>.md               ← original path preserved
```

## Restoration

To restore an archived article:

```bash
# 1. Copy the file back to its original location.
cp backend/content/_archive/<batch>/<category>/<slug>.md \
   backend/content/<category>/<slug>.md

# 2. Re-add the slug to backend/content/_groups.yaml (manual edit).

# 3. Rebuild the search index / restart the backend so the loader
#    picks up the file.
```

The archive log for each batch (`ARCHIVE_LOG_<date>.md`) lists every
restored slug + its original path + audit reason, so this is a guided
manual step, not a recovery hunt.

## Loader exclusion

`backend/services/grammar_content.py` is patched to skip any path
containing `_archive` during recursive globbing — see
`tests/test_grammar_content_archive_exclusion.py` for the regression
pin.  Without that exclusion, archived content would still be loaded
into the wiki at runtime, defeating the drop / merge.

## Git posture

The archive folder IS tracked in Git.  This is intentional — full
history of the wiki should remain reachable from any commit, even
after files are removed from active circulation.
