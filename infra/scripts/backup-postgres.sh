#!/bin/sh
set -eu

SCRIPT_HOME=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
# shellcheck source=common.sh
. "$SCRIPT_HOME/common.sh"

mkdir -p "$BACKUP_ROOT"
chmod 0700 "$BACKUP_ROOT"
umask 077

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_path=$(mktemp "$BACKUP_ROOT/postonce-$timestamp-XXXXXX.dump")
complete=false
cleanup_incomplete() {
  if [ "$complete" != true ] && [ -f "$backup_path" ]; then
    rm -f -- "$backup_path"
  fi
}
trap cleanup_incomplete EXIT HUP INT TERM

compose exec -T db pg_dump \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --format custom \
  --no-owner \
  --no-acl > "$backup_path"

complete=true
trap - EXIT HUP INT TERM

retention_days=${BACKUP_RETENTION_DAYS:-$(read_env_value BACKUP_RETENTION_DAYS)}
retention_days=${retention_days:-14}
case "$retention_days" in
  ''|*[!0-9]*)
    printf '%s\n' "BACKUP_RETENTION_DAYS must be a non-negative integer." >&2
    exit 1
    ;;
esac

find "$BACKUP_ROOT" -type f -name 'postonce-*.dump' -mtime "+$retention_days" -delete
printf '%s\n' "$backup_path"
