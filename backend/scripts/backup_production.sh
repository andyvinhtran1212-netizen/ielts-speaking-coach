#!/usr/bin/env bash
set -euo pipefail

# Hardcode pg_dump path (launchd không có Homebrew PATH)
PG_DUMP="/opt/homebrew/bin/pg_dump"

# Load env vars
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"
source "$BACKEND_DIR/.env"

# Backup destination (outside ~/Documents/ to avoid TCC permission issues)
DEST="$HOME/db-backups"
mkdir -p "$DEST"

# Timestamp
TIMESTAMP=$(date +%Y%m%d_%H%M)
BACKUP_FILE="$DEST/prod_${TIMESTAMP}.sql"

# Run pg_dump
echo "[$(date)] Starting backup → $BACKUP_FILE"
"$PG_DUMP" "$DATABASE_URL" > "$BACKUP_FILE"
echo "[$(date)] Backup complete: $(du -h "$BACKUP_FILE" | cut -f1)"

# Cleanup old backups (keep 7 days)
find "$DEST" -name "prod_*.sql" -mtime +7 -delete
echo "[$(date)] Cleaned up backups older than 7 days"

# List remaining
echo "[$(date)] Current backups:"
ls -lh "$DEST" | tail -n +2
