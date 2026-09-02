#!/bin/sh
set -eu
umask 077

if [ "$#" -ne 2 ]; then
  printf '%s\n' "Usage: $0 postonce-operations.tgz release-id" >&2
  exit 2
fi

archive=$1
release_id=$2
deploy_root=${POSTONCE_DEPLOY_ROOT:-/opt/postonce}
origin_port=${POSTONCE_ORIGIN_PORT:-18044}
host_caddy_env_file=${POSTONCE_HOST_CADDY_ENV_FILE:-/etc/rook/caddy.env}

if [ "$(id -u)" -ne 0 ]; then
  printf '%s\n' "PostOnce deployment requires the approved privileged operator account." >&2
  exit 1
fi
if [ "$deploy_root" != /opt/postonce ] || [ "$origin_port" != 18044 ]; then
  printf '%s\n' "Expected the reviewed /opt/postonce and port 18044 boundary." >&2
  exit 1
fi
case "$release_id" in
  ''|.|..|[!A-Za-z0-9]*|*[!A-Za-z0-9._-]*)
    printf '%s\n' "Release id contains unsupported characters." >&2
    exit 1
    ;;
esac

for command_name in awk caddy cat chmod cp curl dirname docker flock grep id install ln mkdir mktemp mv openssl readlink realpath rm sed stat systemctl tail tar tr; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf '%s\n' "Missing required command: $command_name" >&2
    exit 1
  fi
done
if [ ! -f "$archive" ] || [ -L "$archive" ]; then
  printf '%s\n' "Operations archive must be a regular file." >&2
  exit 1
fi
if tar -tzf "$archive" | sed 's#^\./##' | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
  printf '%s\n' "Operations archive contains an unsafe path." >&2
  exit 1
fi
if tar -tzf "$archive" | sed 's#^\./##' | grep -Ev '^(infra|release-manifest\.env)(/|$)' | grep -q .; then
  printf '%s\n' "Operations archive contains files outside its reviewed boundary." >&2
  exit 1
fi
if tar -tvzf "$archive" | awk '$1 !~ /^[-d]/ {bad=1} END {exit !bad}'; then
  printf '%s\n' "Operations archive must contain only files and directories." >&2
  exit 1
fi

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

exec 9>/var/lock/postonce-deploy.lock
if ! flock -w 120 9; then
  printf '%s\n' "Another PostOnce release operation is active." >&2
  exit 1
fi

releases_root="$deploy_root/releases"
shared_root="$deploy_root/shared"
backup_root="$shared_root/backups"
env_file="$shared_root/postonce.env"
release_dir="$releases_root/$release_id"
current_link="$deploy_root/current"
next_link="$deploy_root/.current-$release_id.next"
ownership_marker="$deploy_root/.postonce-deployment"
site_file=/etc/caddy/sites/postonce.caddy
previous_release=

if [ -e "$deploy_root" ]; then
  if [ -L "$deploy_root" ] || [ ! -d "$deploy_root" ] || \
     [ "$(stat -c '%u' -- "$deploy_root")" -ne 0 ] || \
     [ ! -f "$ownership_marker" ] || [ -L "$ownership_marker" ] || \
     [ "$(stat -c '%u' -- "$ownership_marker")" -ne 0 ] || \
     [ "$(cat -- "$ownership_marker")" != POSTONCE_DEPLOYMENT_V1 ]; then
    printf '%s\n' "Deployment root exists without the PostOnce ownership marker." >&2
    exit 1
  fi
  if [ -L "$current_link" ]; then
    previous_release=$(readlink -f -- "$current_link")
    if [ "$(dirname -- "$previous_release")" != "$releases_root" ]; then
      printf '%s\n' "Current release escapes the managed release root." >&2
      exit 1
    fi
  elif [ -e "$current_link" ]; then
    printf '%s\n' "Current release path is not a symlink." >&2
    exit 1
  fi
else
  if [ -n "$(docker ps -a --filter label=com.docker.compose.project=postonce --format '{{.Names}}')" ]; then
    printf '%s\n' "Unowned PostOnce Docker resources already exist." >&2
    exit 1
  fi
fi
if [ -e "$release_dir" ] || [ -L "$release_dir" ] || [ -e "$next_link" ] || [ -L "$next_link" ]; then
  printf '%s\n' "Release or temporary activation path already exists." >&2
  exit 1
fi

for managed_dir in "$releases_root" "$shared_root" "$backup_root"; do
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

mkdir -p "$releases_root" "$shared_root" "$backup_root"
if [ ! -f "$ownership_marker" ]; then
  printf '%s\n' POSTONCE_DEPLOYMENT_V1 > "$ownership_marker"
  chmod 0600 "$ownership_marker"
fi
chmod 0700 "$shared_root" "$backup_root"

stage_dir=$(mktemp -d "$releases_root/.stage.XXXXXX")
env_snapshot=
site_snapshot=
release_started=false
release_created=false
site_changed=false
completed=false

cleanup() {
  result=$?
  trap - EXIT HUP INT TERM

  case "$stage_dir" in
    "$releases_root"/.stage.*)
      if [ -d "$stage_dir" ] && [ ! -L "$stage_dir" ]; then rm -rf -- "$stage_dir"; fi
      ;;
  esac

  if [ "$completed" != true ]; then
    if [ -n "$env_snapshot" ] && [ -f "$env_snapshot" ]; then
      cp "$env_snapshot" "$env_file"
      chmod 0600 "$env_file"
    fi
    if [ "$release_started" = true ] && [ -n "$previous_release" ] && [ -f "$env_file" ]; then
      docker compose -p postonce --env-file "$env_file" -f "$previous_release/infra/compose.yaml" \
        up -d --no-build --wait --wait-timeout 180 >/dev/null 2>&1 || true
    elif [ "$release_started" = true ] && [ -f "$env_file" ] && [ -f "$release_dir/infra/compose.yaml" ]; then
      # A failed first install may have created only PostOnce containers. Stop
      # that exact Compose project, but preserve its database volume and env.
      docker compose -p postonce --env-file "$env_file" -f "$release_dir/infra/compose.yaml" \
        down >/dev/null 2>&1 || true
    fi
    if [ "$site_changed" = true ]; then
      if [ -n "$site_snapshot" ] && [ -f "$site_snapshot" ]; then
        cp "$site_snapshot" "$site_file"
      else
        rm -f -- "$site_file"
      fi
      caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1 && systemctl reload caddy || true
    fi
    if [ "$release_created" = true ] && [ -d "$release_dir" ] && [ ! -L "$release_dir" ]; then
      active=$(readlink -f -- "$current_link" 2>/dev/null || true)
      case "$release_dir" in
        "$releases_root"/*) if [ "$active" != "$release_dir" ]; then rm -rf -- "$release_dir"; fi ;;
      esac
    fi
    printf '%s\n' "PostOnce deployment stopped; unrelated services were not modified." >&2
  fi

  if [ -n "$env_snapshot" ]; then rm -f -- "$env_snapshot"; fi
  if [ -n "$site_snapshot" ]; then rm -f -- "$site_snapshot"; fi
  rm -f -- "$next_link"
  case "$archive" in /tmp/postonce-operations-*.tgz) rm -f -- "$archive" ;; esac
  exit "$result"
}
trap cleanup EXIT HUP INT TERM

tar -xzf "$archive" -C "$stage_dir" --no-same-owner --no-same-permissions
for required in \
  infra/compose.yaml \
  infra/caddy/host-site.caddy \
  infra/scripts/preflight-vps.sh \
  infra/scripts/healthcheck.sh \
  release-manifest.env
do
  if [ ! -f "$stage_dir/$required" ] || [ -L "$stage_dir/$required" ]; then
    printf '%s\n' "Operations archive is missing a required regular file." >&2
    exit 1
  fi
done

manifest_value() {
  key=$1
  if [ "$(grep -c "^${key}=" "$stage_dir/release-manifest.env")" -ne 1 ]; then
    printf '%s\n' "Release manifest must contain exactly one $key value." >&2
    exit 1
  fi
  sed -n "s/^${key}=//p" "$stage_dir/release-manifest.env" | tail -n 1 | tr -d '\r'
}
api_image=$(manifest_value POSTONCE_API_IMAGE)
gateway_image=$(manifest_value POSTONCE_GATEWAY_IMAGE)
source_revision=$(manifest_value SOURCE_REVISION)
source_repository=$(manifest_value SOURCE_REPOSITORY)

validate_image() {
  image=$1
  expected=$2
  case "$image" in "$expected"@sha256:*) ;; *) return 1 ;; esac
  digest=${image#*@sha256:}
  [ "${#digest}" -eq 64 ] && ! printf '%s' "$digest" | grep -q '[^0-9a-f]'
}
validate_image "$api_image" ghcr.io/yazanbaker94/postonce-api || {
  printf '%s\n' "API image is not an immutable PostOnce GHCR digest." >&2
  exit 1
}
validate_image "$gateway_image" ghcr.io/yazanbaker94/postonce-gateway || {
  printf '%s\n' "Gateway image is not an immutable PostOnce GHCR digest." >&2
  exit 1
}
if [ "$source_revision" != "$release_id" ]; then
  printf '%s\n' "Release id does not match the artifact source revision." >&2
  exit 1
fi
if [ "$source_repository" != yazanbaker94/postonce ]; then
  printf '%s\n' "Operations artifact was not built from the reviewed PostOnce repository." >&2
  exit 1
fi
if [ "${#source_revision}" -ne 40 ] || printf '%s' "$source_revision" | grep -q '[^0-9a-f]'; then
  printf '%s\n' "Release revision must be a full lowercase Git commit SHA." >&2
  exit 1
fi

POSTONCE_DEPLOY_ROOT="$deploy_root" POSTONCE_ORIGIN_PORT="$origin_port" \
POSTONCE_HOST_CADDY_ENV_FILE="$host_caddy_env_file" \
  sh "$stage_dir/infra/scripts/preflight-vps.sh"

mv "$stage_dir" "$release_dir"
stage_dir=
release_created=true

if [ -f "$env_file" ]; then
  if [ -L "$env_file" ] || [ "$(stat -c '%u' -- "$env_file")" -ne 0 ]; then
    printf '%s\n' "PostOnce environment must be a root-owned regular file." >&2
    exit 1
  fi
  if [ "$(stat -c '%a' -- "$env_file")" != 600 ]; then
    printf '%s\n' "PostOnce environment must have mode 0600." >&2
    exit 1
  fi
  env_snapshot=$(mktemp "$shared_root/.postonce-env.previous.XXXXXX")
  cp "$env_file" "$env_snapshot"
else
  postgres_password=$(openssl rand -hex 32)
  {
    printf '%s\n' 'POSTONCE_DOMAIN=postonce.swoop.video'
    printf '%s\n' 'POSTONCE_ORIGIN_PORT=18044'
    printf '%s\n' 'POSTONCE_DEPLOY_ROOT=/opt/postonce'
    printf '%s\n' 'POSTONCE_BACKUP_DIR=/opt/postonce/shared/backups'
    printf '%s\n' 'POSTGRES_DB=postonce'
    printf '%s\n' 'POSTGRES_USER=postonce'
    printf 'POSTGRES_PASSWORD=%s\n' "$postgres_password"
    printf 'DATABASE_URL=postgresql://postonce:%s@db:5432/postonce\n' "$postgres_password"
    printf '%s\n' 'NODE_ENV=production'
    printf '%s\n' 'PORT=3001'
    printf '%s\n' 'DEMO_STORE=postgres'
    printf '%s\n' 'CORS_ORIGINS=https://postonce.swoop.video'
    printf '%s\n' 'DB_POOL_MAX=5'
    printf '%s\n' 'DEMO_MAX_ACTIVE_SESSIONS=500'
    printf '%s\n' 'DEMO_SESSION_TTL_MINUTES=240'
    printf '%s\n' 'DEMO_SESSION_CREATE_LIMIT=12'
    printf '%s\n' 'DEMO_SESSION_CREATE_WINDOW_SECONDS=600'
    printf '%s\n' 'DEMO_SESSION_MUTATION_LIMIT=120'
    printf '%s\n' 'DEMO_SESSION_MUTATION_WINDOW_SECONDS=600'
    printf '%s\n' 'DEMO_RATE_LIMIT_TRACKED_KEYS=4096'
    printf '%s\n' 'BACKUP_RETENTION_DAYS=14'
  } > "$env_file"
  unset postgres_password
  chmod 0600 "$env_file"
fi

set_env_value() {
  env_key=$1
  env_value=$2
  env_next=$(mktemp "$shared_root/.postonce-env.next.XXXXXX")
  awk -v key="$env_key" -v value="$env_value" '
    BEGIN { found = 0 }
    index($0, key "=") == 1 { print key "=" value; found = 1; next }
    { print }
    END { if (!found) print key "=" value }
  ' "$env_file" > "$env_next"
  chmod 0600 "$env_next"
  mv "$env_next" "$env_file"
}

set_env_value POSTONCE_API_IMAGE "$api_image"
set_env_value POSTONCE_GATEWAY_IMAGE "$gateway_image"
set_env_value POSTONCE_DEPLOY_ROOT "$deploy_root"
set_env_value POSTONCE_BACKUP_DIR "$backup_root"
set_env_value POSTONCE_ORIGIN_PORT "$origin_port"
ln -s "$env_file" "$release_dir/infra/.env"

if [ -n "$previous_release" ]; then
  previous_db_ids=$(docker compose -p postonce --env-file "$env_file" \
    -f "$previous_release/infra/compose.yaml" ps --status running --quiet db)
  previous_db_count=$(printf '%s\n' "$previous_db_ids" | awk 'NF {count++} END {print count+0}')
  if [ "$previous_db_count" -ne 1 ]; then
    printf '%s\n' "An update requires exactly one running PostOnce database before backup." >&2
    exit 1
  fi
  POSTONCE_ENV_FILE="$env_file" POSTONCE_DEPLOY_ROOT="$deploy_root" POSTONCE_BACKUP_DIR="$backup_root" \
    sh "$previous_release/infra/scripts/backup-postgres.sh" >/dev/null
fi

docker compose -p postonce --env-file "$env_file" -f "$release_dir/infra/compose.yaml" config --quiet
docker compose -p postonce --env-file "$env_file" -f "$release_dir/infra/compose.yaml" pull db api gateway
release_started=true
docker compose -p postonce --env-file "$env_file" -f "$release_dir/infra/compose.yaml" \
  up -d --no-build --wait --wait-timeout 180

POSTONCE_ENV_FILE="$env_file" POSTONCE_DEPLOY_ROOT="$deploy_root" POSTONCE_BACKUP_DIR="$backup_root" \
  sh "$release_dir/infra/scripts/healthcheck.sh"
curl -fsS --max-time 10 "http://127.0.0.1:$origin_port/healthz" >/dev/null
curl -fsS --max-time 10 "http://127.0.0.1:$origin_port/api/health" >/dev/null
curl -fsS --max-time 10 "http://127.0.0.1:$origin_port/" >/dev/null

if [ -f "$site_file" ]; then
  site_snapshot=$(mktemp "$shared_root/.postonce-site.previous.XXXXXX")
  cp "$site_file" "$site_snapshot"
fi
install -o root -g root -m 0644 "$release_dir/infra/caddy/host-site.caddy" "$site_file"
site_changed=true
caddy validate --config /etc/caddy/Caddyfile >/dev/null
systemctl reload caddy

ln -s "$release_dir" "$next_link"
mv -Tf "$next_link" "$current_link"

completed=true
printf '%s\n' "PostOnce origin release is healthy and active."
printf '%s\n' "Public Cloudflare DNS and TLS verification remain a separate operator step."
