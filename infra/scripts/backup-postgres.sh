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

max_count=${BACKUP_MAX_COUNT:-$(read_env_value BACKUP_MAX_COUNT)}
max_count=${max_count:-7}
case "$max_count" in
  ''|*[!0-9]*)
    printf '%s\n' "BACKUP_MAX_COUNT must be a positive integer." >&2
    exit 1
    ;;
esac
if [ "$max_count" -lt 1 ]; then
  printf '%s\n' "BACKUP_MAX_COUNT must be at least 1." >&2
  exit 1
fi

# Cap rapid-release growth as well as age. Generated backup names contain no
# whitespace; validate the resolved prefix again before deleting any old dump.
find "$BACKUP_ROOT" -maxdepth 1 -type f -name 'postonce-*.dump' -printf '%T@ %p\n' | \
  sort -rn | awk -v keep="$max_count" 'NR > keep { sub(/^[^ ]+ /, ""); print }' | \
  while IFS= read -r old_backup; do
    [ -n "$old_backup" ] || continue
    case "$old_backup" in
      "$BACKUP_ROOT"/postonce-*.dump) rm -f -- "$old_backup" ;;
      *)
        printf '%s\n' "Refusing to prune a backup outside the PostOnce backup root." >&2
        exit 1
        ;;
    esac
  done
printf '%s\n' "$backup_path"
