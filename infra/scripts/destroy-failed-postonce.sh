#!/bin/sh
set -eu
umask 077

if [ "$#" -ne 2 ] || [ "$2" != --yes ]; then
  printf '%s\n' "Usage: $0 expected-current-release-id --yes" >&2
  exit 2
fi

expected_release=$1
deploy_root=${POSTONCE_DEPLOY_ROOT:-/opt/postonce}
origin_port=${POSTONCE_ORIGIN_PORT:-18044}
host_caddy_env_file=${POSTONCE_HOST_CADDY_ENV_FILE:-/etc/rook/caddy.env}
releases_root="$deploy_root/releases"
current_link="$deploy_root/current"
env_file="$deploy_root/shared/postonce.env"
ownership_marker="$deploy_root/.postonce-deployment"
site_file=/etc/caddy/sites/postonce.caddy

if [ "$deploy_root" != /opt/postonce ] || [ "$origin_port" != 18044 ] || \
   [ "$(id -u)" -ne 0 ]; then
  printf '%s\n' "Destruction requires the reviewed PostOnce boundary and privileged operator." >&2
  exit 1
fi
if [ "${#expected_release}" -ne 40 ] || printf '%s' "$expected_release" | grep -q '[^0-9a-f]'; then
  printf '%s\n' "Expected release id must be a full lowercase Git commit SHA." >&2
  exit 1
fi
for command_name in awk basename caddy cat cp dirname docker flock grep id install mktemp readlink realpath rm sort ss stat systemctl; do
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

if [ -L "$deploy_root" ] || [ ! -d "$deploy_root" ] || \
   [ "$(stat -c '%u' -- "$deploy_root")" -ne 0 ] || \
   [ ! -f "$ownership_marker" ] || [ -L "$ownership_marker" ] || \
   [ "$(stat -c '%u' -- "$ownership_marker")" -ne 0 ] || \
   [ "$(cat -- "$ownership_marker")" != POSTONCE_DEPLOYMENT_V1 ]; then
  printf '%s\n' "Destruction target is not the owned PostOnce deployment." >&2
  exit 1
fi
if [ ! -L "$current_link" ]; then
  printf '%s\n' "Destruction requires an active PostOnce release symlink." >&2
  exit 1
fi
current_release=$(readlink -f -- "$current_link")
if [ "$(dirname -- "$current_release")" != "$releases_root" ] || \
   [ "$(basename -- "$current_release")" != "$expected_release" ] || \
   [ ! -d "$current_release" ] || [ "$(stat -c '%u' -- "$current_release")" -ne 0 ]; then
  printf '%s\n' "Active release does not match the explicitly approved failed release." >&2
  exit 1
fi
if [ ! -f "$env_file" ] || [ -L "$env_file" ] || \
   [ "$(stat -c '%u' -- "$env_file")" -ne 0 ] || \
   [ "$(stat -c '%a' -- "$env_file")" != 600 ] || \
   [ ! -f "$current_release/infra/compose.yaml" ] || \
   [ -L "$current_release/infra/compose.yaml" ]; then
  printf '%s\n' "Owned environment or active Compose definition is unsafe." >&2
  exit 1
fi
if [ ! -f "$site_file" ] || [ -L "$site_file" ] || \
   [ "$(stat -c '%u' -- "$site_file")" -ne 0 ] || \
   ! grep -Fxq '# POSTONCE_HOST_SITE_V1' "$site_file"; then
  printf '%s\n' "PostOnce Caddy drop-in is missing its ownership marker." >&2
  exit 1
fi

expected_containers=$(printf '%s\n' \
  'postonce-api-1|api' \
  'postonce-db-1|db' \
  'postonce-gateway-1|gateway' | sort)
actual_containers=$(docker ps -a --filter label=com.docker.compose.project=postonce \
  --format '{{.Names}}|{{.Label "com.docker.compose.service"}}' | sort)
expected_networks=$(printf '%s\n' postonce_data postonce_edge | sort)
actual_networks=$(docker network ls --filter label=com.docker.compose.project=postonce \
  --format '{{.Name}}' | sort)
actual_volumes=$(docker volume ls --filter label=com.docker.compose.project=postonce \
  --format '{{.Name}}' | sort)
if [ "$actual_containers" != "$expected_containers" ] || \
   [ "$actual_networks" != "$expected_networks" ] || \
   [ "$actual_volumes" != postonce_postgres_data ]; then
  printf '%s\n' "PostOnce Docker resources do not match the reviewed three-service boundary." >&2
  exit 1
fi

listener_addresses=$(ss -ltnH | awk -v port="$origin_port" '$4 ~ (":" port "$") {print $4}')
if [ -n "$listener_addresses" ] && \
   { [ "$listener_addresses" != "127.0.0.1:$origin_port" ] || \
     [ "$(docker ps --filter label=com.docker.compose.project=postonce \
       --filter label=com.docker.compose.service=gateway --format '{{.Names}}')" != postonce-gateway-1 ]; }; then
  printf '%s\n' "Origin port 18044 is not exclusively owned by the reviewed PostOnce gateway." >&2
  exit 1
fi

for protected_service in docker.service caddy.service ytmp3-api@8080.service ytmp3-api@8081.service ytmp3-pot.service; do
  if ! systemctl is-active --quiet "$protected_service"; then
    printf '%s\n' "Protected shared-host service is not active: $protected_service" >&2
    exit 1
  fi
done
if [ -n "$host_caddy_env_file" ]; then
  if [ ! -f "$host_caddy_env_file" ] || [ -L "$host_caddy_env_file" ] || \
     [ "$(stat -c '%u' -- "$host_caddy_env_file")" -ne 0 ]; then
    printf '%s\n' "Host Caddy environment file must be a root-owned regular file." >&2
    exit 1
  fi
  set -a
  # shellcheck disable=SC1090
  . "$host_caddy_env_file"
  set +a
fi
caddy validate --config /etc/caddy/Caddyfile >/dev/null

image_refs=
site_snapshot=
cleanup() {
  [ -z "$image_refs" ] || rm -f -- "$image_refs"
  [ -z "$site_snapshot" ] || rm -f -- "$site_snapshot"
}
trap cleanup EXIT HUP INT TERM
image_refs=$(mktemp /tmp/.postonce-destroy-images.XXXXXX)
site_snapshot=$(mktemp /tmp/.postonce-destroy-site.XXXXXX)

docker image ls --digests --format '{{.Repository}}@{{.Digest}}' | \
  grep -E '^ghcr\.io/yazanbaker94/postonce-(api|gateway)@sha256:[0-9a-f]{64}$' | \
  sort -u > "$image_refs" || true
cp "$site_file" "$site_snapshot"

# This is the intentional irreversible boundary: synthetic PostOnce database
# state, all three containers, and both private networks are removed together.
docker compose -p postonce --env-file "$env_file" \
  -f "$current_release/infra/compose.yaml" \
  down --volumes --remove-orphans --timeout 30

remaining_resources=$(
  docker ps -a --filter label=com.docker.compose.project=postonce --format 'container {{.Names}}'
  docker network ls --filter label=com.docker.compose.project=postonce --format 'network {{.Name}}'
  docker volume ls --filter label=com.docker.compose.project=postonce --format 'volume {{.Name}}'
)
if [ -n "$remaining_resources" ]; then
  printf '%s\n' "PostOnce Docker teardown was incomplete; filesystem deletion was not attempted." >&2
  exit 1
fi
if ss -ltnH | awk -v port="$origin_port" '$4 ~ (":" port "$") {found=1} END {exit !found}'; then
  printf '%s\n' "Origin port 18044 remains occupied; filesystem deletion was not attempted." >&2
  exit 1
fi

rm -f -- "$site_file"
if ! caddy validate --config /etc/caddy/Caddyfile >/dev/null; then
  install -o root -g root -m 0644 "$site_snapshot" "$site_file"
  caddy validate --config /etc/caddy/Caddyfile >/dev/null || true
  systemctl reload caddy || true
  printf '%s\n' "Caddy validation failed after removing the PostOnce site; the drop-in was restored." >&2
  exit 1
fi
if ! systemctl reload caddy; then
  install -o root -g root -m 0644 "$site_snapshot" "$site_file"
  caddy validate --config /etc/caddy/Caddyfile >/dev/null || true
  systemctl reload caddy || true
  printf '%s\n' "Caddy reload failed after removing the PostOnce site; the drop-in was restored." >&2
  exit 1
fi

if [ "$deploy_root" != /opt/postonce ] || [ -L "$deploy_root" ] || \
   [ "$(cat -- "$ownership_marker")" != POSTONCE_DEPLOYMENT_V1 ]; then
  printf '%s\n' "PostOnce root changed during teardown; refusing filesystem deletion." >&2
  exit 1
fi
rm -rf -- "$deploy_root"

image_removal_failed=false
while IFS= read -r image; do
  [ -n "$image" ] || continue
  if docker image inspect "$image" >/dev/null 2>&1 && \
     ! docker image rm "$image" >/dev/null 2>&1; then
    image_removal_failed=true
    printf '%s\n' "Unable to remove an old PostOnce image reference: $image" >&2
  fi
done < "$image_refs"

for protected_service in docker.service caddy.service ytmp3-api@8080.service ytmp3-api@8081.service ytmp3-pot.service; do
  systemctl is-active --quiet "$protected_service" || {
    printf '%s\n' "Protected shared-host service changed state during PostOnce teardown: $protected_service" >&2
    exit 1
  }
done
if [ "$image_removal_failed" = true ]; then
  printf '%s\n' "Failed PostOnce runtime and data were deleted, but an old image reference needs review." >&2
  exit 1
fi

printf '%s\n' "Failed PostOnce installation fully removed within its owned VPS boundary."
printf '%s\n' "AudioFetcher units and unrelated Docker projects remained active."
