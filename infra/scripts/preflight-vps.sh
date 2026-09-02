#!/bin/sh
set -eu

# Read-only validation for the reviewed shared VPS. This script never creates
# files, pulls images, starts containers, or reloads Caddy.

origin_port=${POSTONCE_ORIGIN_PORT:-18044}
deploy_root=${POSTONCE_DEPLOY_ROOT:-/opt/postonce}
host_caddy_env_file=${POSTONCE_HOST_CADDY_ENV_FILE:-/etc/rook/caddy.env}

case "$origin_port" in
  ''|*[!0-9]*)
    printf '%s\n' "POSTONCE_ORIGIN_PORT must be numeric." >&2
    exit 1
    ;;
esac
if [ "$origin_port" -lt 1024 ] || [ "$origin_port" -gt 65535 ]; then
  printf '%s\n' "POSTONCE_ORIGIN_PORT must be between 1024 and 65535." >&2
  exit 1
fi
if [ "$deploy_root" != /opt/postonce ] || [ "$origin_port" != 18044 ]; then
  printf '%s\n' "Expected the reviewed /opt/postonce and loopback port 18044 boundary." >&2
  exit 1
fi

for command_name in awk caddy cat df dirname docker flock grep id openssl readlink realpath ss stat systemctl tar; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf '%s\n' "Missing required command: $command_name" >&2
    exit 1
  fi
done
if [ "$(id -u)" -ne 0 ]; then
  printf '%s\n' "Deployment requires the approved privileged operator account." >&2
  exit 1
fi
docker compose version >/dev/null
if ! docker compose up --help | grep -q -- '--wait'; then
  printf '%s\n' "Docker Compose must support bounded startup waiting." >&2
  exit 1
fi
systemctl is-active --quiet docker
systemctl is-active --quiet caddy

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
if ! grep -Eq '^[[:space:]]*import[[:space:]]+/etc/caddy/sites/\*\.caddy[[:space:]]*$' /etc/caddy/Caddyfile; then
  printf '%s\n' "Host Caddy does not import isolated site drop-ins." >&2
  exit 1
fi

ownership_marker="$deploy_root/.postonce-deployment"
releases_root="$deploy_root/releases"
current_link="$deploy_root/current"
owned_install=false

validate_current_release() {
  if [ ! -L "$current_link" ]; then
    printf '%s\n' "PostOnce current must be a release symlink." >&2
    return 1
  fi
  release_target=$(readlink -f -- "$current_link") || return 1
  if [ ! -d "$release_target" ] || [ "$(dirname -- "$release_target")" != "$releases_root" ] || \
     [ "$(stat -c '%u' -- "$release_target")" -ne 0 ]; then
    printf '%s\n' "PostOnce current release escapes the managed release root." >&2
    return 1
  fi
  for required in infra/compose.yaml infra/scripts/healthcheck.sh release-manifest.env; do
    if [ ! -f "$release_target/$required" ] || [ -L "$release_target/$required" ]; then
      printf '%s\n' "PostOnce current release is missing a required regular file." >&2
      return 1
    fi
  done
}

postonce_docker_resources() {
  docker ps -a --filter label=com.docker.compose.project=postonce --format 'container {{.Names}}'
  docker network ls --filter label=com.docker.compose.project=postonce --format 'network {{.Name}}'
  docker volume ls --filter label=com.docker.compose.project=postonce --format 'volume {{.Name}}'
}

if [ -e "$deploy_root" ]; then
  if [ -L "$deploy_root" ] || [ ! -d "$deploy_root" ] || \
     [ "$(stat -c '%u' -- "$deploy_root")" -ne 0 ] || \
     [ ! -f "$ownership_marker" ] || [ -L "$ownership_marker" ] || \
     [ "$(stat -c '%u' -- "$ownership_marker")" -ne 0 ] || \
     [ "$(cat -- "$ownership_marker")" != POSTONCE_DEPLOYMENT_V1 ]; then
    printf '%s\n' "Deployment root exists without the PostOnce ownership marker." >&2
    exit 1
  fi
  owned_install=true
  if [ -e "$current_link" ] || [ -L "$current_link" ]; then
    validate_current_release
    shared_env="$deploy_root/shared/postonce.env"
    if [ ! -f "$shared_env" ] || [ -L "$shared_env" ] || \
       [ "$(stat -c '%u' -- "$shared_env")" -ne 0 ] || \
       [ "$(stat -c '%a' -- "$shared_env")" != 600 ]; then
      printf '%s\n' "Active PostOnce installation requires a root-owned mode 0600 environment file." >&2
      exit 1
    fi
  fi
fi

for managed_dir in "$releases_root" "$deploy_root/shared" "$deploy_root/shared/backups"; do
  if [ -L "$managed_dir" ]; then
    printf '%s\n' "Managed PostOnce directories must not be symlinks." >&2
    exit 1
  fi
  if [ -e "$managed_dir" ] && \
     { [ ! -d "$managed_dir" ] || [ "$(stat -c '%u' -- "$managed_dir")" -ne 0 ]; }; then
    printf '%s\n' "Managed PostOnce path is not a root-owned directory." >&2
    exit 1
  fi
done

resource_report=$(postonce_docker_resources)
if [ -n "$resource_report" ] && [ "$owned_install" != true ]; then
  printf '%s\n' "Docker already contains resources reserved for project postonce." >&2
  exit 1
fi

site_file=/etc/caddy/sites/postonce.caddy
if [ -e "$site_file" ] || [ -L "$site_file" ]; then
  if [ ! -f "$site_file" ] || [ -L "$site_file" ] || \
     [ "$(stat -c '%u' -- "$site_file")" -ne 0 ] || \
     ! grep -Fxq '# POSTONCE_HOST_SITE_V1' "$site_file"; then
    printf '%s\n' "PostOnce Caddy drop-in exists without its ownership marker." >&2
    exit 1
  fi
fi

listener_addresses=$(ss -ltnH | awk -v port="$origin_port" '$4 ~ (":" port "$") {print $4}')
if [ -n "$listener_addresses" ]; then
  if printf '%s\n' "$listener_addresses" | grep -Ev "^127\\.0\\.0\\.1:${origin_port}$" | grep -q .; then
    printf '%s\n' "Origin port has a non-loopback listener." >&2
    exit 1
  fi
  gateway_ids=$(docker ps \
    --filter label=com.docker.compose.project=postonce \
    --filter label=com.docker.compose.service=gateway \
    --format '{{.ID}}')
  # shellcheck disable=SC2086
  set -- $gateway_ids
  if [ "$#" -ne 1 ]; then
    printf '%s\n' "Loopback origin is not owned by exactly one PostOnce gateway." >&2
    exit 1
  fi
  binding=$(docker inspect --format '{{range (index .HostConfig.PortBindings "8080/tcp")}}{{.HostIp}}:{{.HostPort}}{{end}}' "$1")
  if [ "$binding" != "127.0.0.1:$origin_port" ]; then
    printf '%s\n' "PostOnce gateway has an unexpected host binding." >&2
    exit 1
  fi
  printf '%s\n' "Existing PostOnce loopback origin ownership is valid."
else
  printf '%s\n' "Loopback origin port 18044 is available."
fi

available_kib=$(df -Pk /opt | awk 'NR == 2 {print $4}')
if [ "${available_kib:-0}" -lt 5242880 ]; then
  printf '%s\n' "At least 5 GiB free below /opt is required." >&2
  exit 1
fi
memory_kib=$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)
if [ "${memory_kib:-0}" -lt 2097152 ]; then
  printf '%s\n' "At least 2 GiB RAM is required." >&2
  exit 1
fi

printf '%s\n' "PostOnce VPS preflight passed without changes."
printf '%s\n' "Managed boundary: /opt/postonce, Compose project postonce, loopback port 18044, one Caddy site drop-in."
