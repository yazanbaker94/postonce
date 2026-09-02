#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
INFRA_DIR=$(CDPATH='' cd -- "$SCRIPT_DIR/.." && pwd -P)
PROJECT_DIR=$(CDPATH='' cd -- "$INFRA_DIR/.." && pwd -P)
COMPOSE_FILE="$INFRA_DIR/compose.yaml"
ENV_FILE=${POSTONCE_ENV_FILE:-"$INFRA_DIR/.env"}

if [ ! -f "$ENV_FILE" ]; then
  printf '%s\n' "Missing protected PostOnce environment file." >&2
  exit 1
fi
if ! command -v docker >/dev/null 2>&1; then
  printf '%s\n' "Docker is required." >&2
  exit 1
fi

read_env_value() {
  key=$1
  sed -n "s/^${key}=//p" "$ENV_FILE" | tail -n 1 | tr -d '\r'
}

compose() {
  docker compose -p postonce --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

DEPLOY_ROOT=${POSTONCE_DEPLOY_ROOT:-$(read_env_value POSTONCE_DEPLOY_ROOT)}
DEPLOY_ROOT=${DEPLOY_ROOT:-"$PROJECT_DIR"}
BACKUP_ROOT=${POSTONCE_BACKUP_DIR:-$(read_env_value POSTONCE_BACKUP_DIR)}
BACKUP_ROOT=${BACKUP_ROOT:-"$DEPLOY_ROOT/shared/backups"}

for candidate in "$DEPLOY_ROOT" "$BACKUP_ROOT"; do
  case "$candidate" in
    /|/bin|/boot|/dev|/etc|/home|/opt|/root|/run|/srv|/tmp|/usr|/var)
      printf '%s\n' "Refusing a broad PostOnce path." >&2
      exit 1
      ;;
    /*) ;;
    *)
      printf '%s\n' "PostOnce paths must be absolute." >&2
      exit 1
      ;;
  esac
done

DEPLOY_ROOT=$(realpath -m -- "$DEPLOY_ROOT")
BACKUP_ROOT=$(realpath -m -- "$BACKUP_ROOT")
case "$BACKUP_ROOT" in
  "$DEPLOY_ROOT"/*) ;;
  *)
    printf '%s\n' "Backup directory must remain inside the PostOnce deployment root." >&2
    exit 1
    ;;
esac

POSTGRES_USER=${POSTGRES_USER:-$(read_env_value POSTGRES_USER)}
POSTGRES_USER=${POSTGRES_USER:-postonce}
POSTGRES_DB=${POSTGRES_DB:-$(read_env_value POSTGRES_DB)}
POSTGRES_DB=${POSTGRES_DB:-postonce}
