# shellcheck shell=bash
# Shared helpers for offsite_backup.sh and restore_drill.sh. Source, don't run.
#
# Destination is pluggable through OFFSITE_DEST_KIND:
#   s3   (default) any S3-compatible store: Cloudflare R2, Backblaze B2, AWS S3...
#        OFFSITE_S3_ENDPOINT, OFFSITE_S3_BUCKET, OFFSITE_S3_ACCESS_KEY_ID,
#        OFFSITE_S3_SECRET_ACCESS_KEY, optional OFFSITE_S3_REGION (default auto)
#   file a local directory, OFFSITE_FILE_ROOT (tests and manual local drills)

BACKUP_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC2034  # used by the scripts that source this file
BUNDLE_TOOLS="$BACKUP_LIB_DIR/bundle_tools.py"

log() { printf '%s %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; }
die() { printf '::error::%s\n' "$*" >&2; exit 1; }

# Fail once, listing every missing variable by name (never by value).
require_vars() {
  local missing=() name
  for name in "$@"; do
    [ -n "${!name:-}" ] || missing+=("$name")
  done
  [ "${#missing[@]}" -eq 0 ] || die "missing configuration: ${missing[*]} (see docs/runbooks/offsite-backup.md)"
}

summary() {
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    printf '%s\n' "$*" >> "$GITHUB_STEP_SUMMARY"
  fi
}

dest_init() {
  OFFSITE_DEST_KIND="${OFFSITE_DEST_KIND:-s3}"
  case "$OFFSITE_DEST_KIND" in
    s3)
      require_vars OFFSITE_S3_ENDPOINT OFFSITE_S3_BUCKET OFFSITE_S3_ACCESS_KEY_ID OFFSITE_S3_SECRET_ACCESS_KEY
      command -v aws >/dev/null || die "aws CLI not found"
      export AWS_ACCESS_KEY_ID="$OFFSITE_S3_ACCESS_KEY_ID"
      export AWS_SECRET_ACCESS_KEY="$OFFSITE_S3_SECRET_ACCESS_KEY"
      export AWS_DEFAULT_REGION="${OFFSITE_S3_REGION:-auto}"
      unset AWS_SESSION_TOKEN AWS_PROFILE
      # R2 and B2 reject the CRC checksums AWS CLI >= 2.23 sends by default.
      export AWS_REQUEST_CHECKSUM_CALCULATION=when_required
      export AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
      export AWS_EC2_METADATA_DISABLED=true
      ;;
    file)
      require_vars OFFSITE_FILE_ROOT
      mkdir -p "$OFFSITE_FILE_ROOT"
      ;;
    *) die "OFFSITE_DEST_KIND must be s3 or file" ;;
  esac
}

_aws() { aws --endpoint-url "$OFFSITE_S3_ENDPOINT" "$@"; }

# dest_put_stream KEY [EXPECTED_BYTES] < data
dest_put_stream() {
  case "$OFFSITE_DEST_KIND" in
    s3) _aws s3 cp --only-show-errors - "s3://$OFFSITE_S3_BUCKET/$1" ${2:+--expected-size "$2"} ;;
    file) mkdir -p "$(dirname "$OFFSITE_FILE_ROOT/$1")" && cat > "$OFFSITE_FILE_ROOT/$1" ;;
  esac
}

# dest_put_file LOCAL KEY
dest_put_file() {
  case "$OFFSITE_DEST_KIND" in
    s3) _aws s3 cp --only-show-errors "$1" "s3://$OFFSITE_S3_BUCKET/$2" ;;
    file) mkdir -p "$(dirname "$OFFSITE_FILE_ROOT/$2")" && cp "$1" "$OFFSITE_FILE_ROOT/$2" ;;
  esac
}

# dest_get_stream KEY > data
dest_get_stream() {
  case "$OFFSITE_DEST_KIND" in
    s3) _aws s3 cp --only-show-errors "s3://$OFFSITE_S3_BUCKET/$1" - ;;
    file) cat "$OFFSITE_FILE_ROOT/$1" ;;
  esac
}

# dest_list_keys PREFIX -> one key per line
dest_list_keys() {
  case "$OFFSITE_DEST_KIND" in
    s3)
      local keys
      keys="$(_aws s3api list-objects-v2 --bucket "$OFFSITE_S3_BUCKET" --prefix "$1" \
        --query 'Contents[].Key' --output text)" || die "cannot list the destination bucket"
      printf '%s\n' "$keys" | tr '\t' '\n' | grep -v -e '^None$' -e '^$' || true
      ;;
    file)
      if [ -d "$OFFSITE_FILE_ROOT/$1" ]; then
        (cd "$OFFSITE_FILE_ROOT" && find "$1" -type f | sort)
      fi
      ;;
  esac
}
