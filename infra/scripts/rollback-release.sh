#!/bin/sh
set -eu
umask 077

if [ "$#" -ne 2 ] || [ "$2" != --yes ]; then
  printf '%s\n' "Usage: $0 release-id --yes" >&2
  exit 2
fi

release_id=$1
deploy_root=${POSTONCE_DEPLOY_ROOT:-/opt/postonce}
origin_port=${POSTONCE_ORIGIN_PORT:-18044}
case "$release_id" in
  ''|.|..|[!A-Za-z0-9]*|*[!A-Za-z0-9._-]*)
    printf '%s\n' "Release id contains unsupported characters." >&2
    exit 1
    ;;
esac
if [ "$deploy_root" != /opt/postonce ] || [ "$origin_port" != 18044 ] || [ "$(id -u)" -ne 0 ]; then
  printf '%s\n' "Rollback requires the reviewed PostOnce VPS boundary and privileged operator." >&2
  exit 1
fi
for command_name in awk cat chmod cp dirname docker flock grep id ln mktemp mv readlink realpath rm sed stat systemctl tail tr; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf '%s\n' "Missing required command: $command_name" >&2
    exit 1
  fi
done

exec 9>/var/lock/postonce-deploy.lock
if ! flock -w 120 9; then
  printf '%s\n' "Another PostOnce release operation is active." >&2
  exit 1
fi

for protected_service in ytmp3-api@8080.service ytmp3-api@8081.service ytmp3-pot.service caddy.service docker.service; do
  if ! systemctl is-active --quiet "$protected_service"; then
    printf '%s\n' "Protected shared-host service is not active: $protected_service" >&2
    exit 1
  fi
done

releases_root="$deploy_root/releases"
current_link="$deploy_root/current"
target_release="$releases_root/$release_id"
env_file="$deploy_root/shared/postonce.env"
next_link="$deploy_root/.rollback-$release_id.next"
ownership_marker="$deploy_root/.postonce-deployment"

if [ -L "$deploy_root" ] || [ ! -d "$deploy_root" ] || \
   [ "$(stat -c '%u' -- "$deploy_root")" -ne 0 ] || \
   [ ! -f "$ownership_marker" ] || [ -L "$ownership_marker" ] || \
   [ "$(stat -c '%u' -- "$ownership_marker")" -ne 0 ] || \
   [ "$(cat -- "$ownership_marker")" != POSTONCE_DEPLOYMENT_V1 ]; then
  printf '%s\n' "Rollback root is not the owned PostOnce deployment." >&2
  exit 1
fi
if [ ! -L "$current_link" ]; then
  printf '%s\n' "No active PostOnce release is available." >&2
  exit 1
fi
current_release=$(readlink -f -- "$current_link")
requested_target="$target_release"
target_release=$(realpath -e -- "$requested_target") || {
  printf '%s\n' "Requested rollback release does not exist." >&2
  exit 1
}
if [ "$(dirname -- "$current_release")" != "$releases_root" ] || \
   [ "$(dirname -- "$target_release")" != "$releases_root" ] || \
   [ ! -d "$requested_target" ] || [ -L "$requested_target" ] || \
   [ "$(stat -c '%u' -- "$target_release")" -ne 0 ] || \
   [ ! -f "$target_release/infra/compose.yaml" ] || [ -L "$target_release/infra/compose.yaml" ] || \
   [ ! -f "$target_release/infra/scripts/healthcheck.sh" ] || [ -L "$target_release/infra/scripts/healthcheck.sh" ] || \
   [ ! -f "$target_release/release-manifest.env" ] || [ -L "$target_release/release-manifest.env" ]; then
  printf '%s\n' "Rollback target is outside the managed release boundary." >&2
  exit 1
fi
if [ ! -f "$env_file" ] || [ -L "$env_file" ] || \
   [ "$(stat -c '%u' -- "$env_file")" -ne 0 ] || [ "$(stat -c '%a' -- "$env_file")" != 600 ]; then
  printf '%s\n' "PostOnce environment must be a root-owned mode 0600 regular file." >&2
  exit 1
fi
if [ -e "$next_link" ] || [ -L "$next_link" ]; then
  printf '%s\n' "A stale rollback activation path already exists." >&2
  exit 1
fi
if [ "$target_release" = "$current_release" ]; then
  printf '%s\n' "Requested release is already active."
  exit 0
fi

manifest_value() {
  key=$1
  if [ "$(grep -c "^${key}=" "$target_release/release-manifest.env")" -ne 1 ]; then
    printf '%s\n' "Rollback manifest must contain exactly one $key value." >&2
    exit 1
  fi
  sed -n "s/^${key}=//p" "$target_release/release-manifest.env" | tail -n 1 | tr -d '\r'
}
api_image=$(manifest_value POSTONCE_API_IMAGE)
gateway_image=$(manifest_value POSTONCE_GATEWAY_IMAGE)
source_revision=$(manifest_value SOURCE_REVISION)
source_repository=$(manifest_value SOURCE_REPOSITORY)
if [ "$source_revision" != "$release_id" ] || [ "$source_repository" != yazanbaker94/postonce ]; then
  printf '%s\n' "Rollback target does not match its reviewed source manifest." >&2
  exit 1
fi
if [ "${#source_revision}" -ne 40 ] || printf '%s' "$source_revision" | grep -q '[^0-9a-f]'; then
  printf '%s\n' "Rollback revision must be a full lowercase Git commit SHA." >&2
  exit 1
fi
for pair in \
  "ghcr.io/yazanbaker94/postonce-api|$api_image" \
  "ghcr.io/yazanbaker94/postonce-gateway|$gateway_image"
do
  expected=${pair%%|*}
  image=${pair#*|}
  case "$image" in "$expected"@sha256:*) ;; *)
    printf '%s\n' "Rollback manifest contains an invalid image reference." >&2
    exit 1
    ;;
  esac
  digest=${image#*@sha256:}
  if [ "${#digest}" -ne 64 ] || printf '%s' "$digest" | grep -q '[^0-9a-f]'; then
    printf '%s\n' "Rollback manifest contains an invalid image digest." >&2
    exit 1
  fi
done

env_snapshot=$(mktemp "$deploy_root/shared/.postonce-rollback-env.XXXXXX")
cp "$env_file" "$env_snapshot"
completed=false
cleanup() {
  result=$?
  trap - EXIT HUP INT TERM
  if [ "$completed" != true ]; then
    cp "$env_snapshot" "$env_file"
    chmod 0600 "$env_file"
    docker compose -p postonce --env-file "$env_file" -f "$current_release/infra/compose.yaml" \
      up -d --no-build --remove-orphans --wait --wait-timeout 180 >/dev/null 2>&1 || true
    printf '%s\n' "Rollback failed; the previous application release was requested again." >&2
  fi
  rm -f -- "$env_snapshot" "$next_link"
  exit "$result"
}
trap cleanup EXIT HUP INT TERM

POSTONCE_ENV_FILE="$env_file" POSTONCE_DEPLOY_ROOT="$deploy_root" \
POSTONCE_BACKUP_DIR="$deploy_root/shared/backups" \
  sh "$current_release/infra/scripts/backup-postgres.sh" >/dev/null

set_env_value() {
  key=$1
  value=$2
  next=$(mktemp "$deploy_root/shared/.postonce-rollback-env-next.XXXXXX")
  awk -v key="$key" -v value="$value" '
    BEGIN {found=0}
    index($0,key "=")==1 {print key "=" value; found=1; next}
    {print}
    END {if(!found) print key "=" value}
  ' "$env_file" > "$next"
  chmod 0600 "$next"
  mv "$next" "$env_file"
}
set_env_value POSTONCE_API_IMAGE "$api_image"
set_env_value POSTONCE_GATEWAY_IMAGE "$gateway_image"

docker compose -p postonce --env-file "$env_file" -f "$target_release/infra/compose.yaml" config --quiet
for rollback_image in "$api_image" "$gateway_image"; do
  if ! docker image inspect "$rollback_image" >/dev/null 2>&1; then
    docker pull "$rollback_image"
  fi
done
docker compose -p postonce --env-file "$env_file" -f "$target_release/infra/compose.yaml" \
  up -d --no-build --remove-orphans --wait --wait-timeout 180
POSTONCE_ENV_FILE="$env_file" POSTONCE_DEPLOY_ROOT="$deploy_root" \
POSTONCE_BACKUP_DIR="$deploy_root/shared/backups" \
  sh "$target_release/infra/scripts/healthcheck.sh"

for protected_service in ytmp3-api@8080.service ytmp3-api@8081.service ytmp3-pot.service caddy.service docker.service; do
  if ! systemctl is-active --quiet "$protected_service"; then
    printf '%s\n' "Protected shared-host service changed state during rollback: $protected_service" >&2
    exit 1
  fi
done

ln -s "$target_release" "$next_link"
mv -Tf "$next_link" "$current_link"
completed=true
printf '%s\n' "PostOnce application rollback is healthy and active."
printf '%s\n' "Database migrations were not reversed; the pre-rollback backup was preserved."
