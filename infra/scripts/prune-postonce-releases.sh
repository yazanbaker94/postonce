#!/bin/sh
set -eu
umask 077

if [ "$#" -gt 1 ]; then
  printf '%s\n' "Usage: $0 [previous-release-directory]" >&2
  exit 2
fi

deploy_root=${POSTONCE_DEPLOY_ROOT:-/opt/postonce}
previous_release=${1:-}
releases_root="$deploy_root/releases"
current_link="$deploy_root/current"
ownership_marker="$deploy_root/.postonce-deployment"

if [ "$deploy_root" != /opt/postonce ] || [ "$(id -u)" -ne 0 ]; then
  printf '%s\n' "Release pruning requires the reviewed PostOnce boundary and privileged operator." >&2
  exit 1
fi
for command_name in basename cat dirname docker grep id mktemp readlink realpath rm sed sort stat; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf '%s\n' "Missing required command: $command_name" >&2
    exit 1
  fi
done
if [ -L "$deploy_root" ] || [ ! -d "$deploy_root" ] || \
   [ "$(stat -c '%u' -- "$deploy_root")" -ne 0 ] || \
   [ ! -f "$ownership_marker" ] || [ -L "$ownership_marker" ] || \
   [ "$(stat -c '%u' -- "$ownership_marker")" -ne 0 ] || \
   [ "$(cat -- "$ownership_marker")" != POSTONCE_DEPLOYMENT_V1 ]; then
  printf '%s\n' "Release pruning root is not the owned PostOnce deployment." >&2
  exit 1
fi
if [ ! -L "$current_link" ]; then
  printf '%s\n' "Release pruning requires an active PostOnce release symlink." >&2
  exit 1
fi
current_release=$(readlink -f -- "$current_link")

validate_release_path() {
  requested=$1
  resolved=$(realpath -e -- "$requested") || return 1
  release_name=$(basename -- "$resolved")
  if [ "$(dirname -- "$resolved")" != "$releases_root" ] || \
     [ ! -d "$requested" ] || [ -L "$requested" ] || \
     [ "$(stat -c '%u' -- "$resolved")" -ne 0 ] || \
     ! printf '%s' "$release_name" | grep -Eq '^[0-9a-f]{40}$'; then
    return 1
  fi
  manifest="$resolved/release-manifest.env"
  if [ ! -f "$manifest" ] || [ -L "$manifest" ]; then
    return 1
  fi
  printf '%s\n' "$resolved"
}

current_release=$(validate_release_path "$current_release") || {
  printf '%s\n' "Current PostOnce release is outside the managed release boundary." >&2
  exit 1
}
if [ -n "$previous_release" ]; then
  previous_release=$(validate_release_path "$previous_release") || {
    printf '%s\n' "Previous PostOnce release is outside the managed release boundary." >&2
    exit 1
  }
fi

manifest_value() {
  release=$1
  key=$2
  release_manifest="$release/release-manifest.env"
  count=$(grep -c "^${key}=" "$release_manifest" || true)
  if [ "$count" -ne 1 ]; then
    printf '%s\n' "Release manifest must contain exactly one $key value: $release" >&2
    return 1
  fi
  sed -n "s/^${key}=//p" "$release_manifest"
}

validate_image() {
  image=$1
  expected=$2
  case "$image" in "$expected"@sha256:*) ;; *) return 1 ;; esac
  digest=${image#*@sha256:}
  [ "${#digest}" -eq 64 ] && ! printf '%s' "$digest" | grep -q '[^0-9a-f]'
}

release_images() {
  release=$1
  release_name=$(basename -- "$release")
  source_revision=$(manifest_value "$release" SOURCE_REVISION) || return 1
  source_repository=$(manifest_value "$release" SOURCE_REPOSITORY) || return 1
  api_image=$(manifest_value "$release" POSTONCE_API_IMAGE) || return 1
  gateway_image=$(manifest_value "$release" POSTONCE_GATEWAY_IMAGE) || return 1
  if [ "$source_revision" != "$release_name" ] || \
     [ "$source_repository" != yazanbaker94/postonce ] || \
     ! validate_image "$api_image" ghcr.io/yazanbaker94/postonce-api || \
     ! validate_image "$gateway_image" ghcr.io/yazanbaker94/postonce-gateway; then
    printf '%s\n' "Release manifest is not an approved immutable PostOnce release: $release" >&2
    return 1
  fi
  printf '%s\n%s\n' "$api_image" "$gateway_image"
}

shared_root="$deploy_root/shared"
keep_images=
remove_images=
release_plan=
cleanup() {
  [ -z "$keep_images" ] || rm -f -- "$keep_images"
  [ -z "$remove_images" ] || rm -f -- "$remove_images"
  [ -z "$release_plan" ] || rm -f -- "$release_plan"
}
trap cleanup EXIT HUP INT TERM
keep_images=$(mktemp "$shared_root/.postonce-prune-keep.XXXXXX")
remove_images=$(mktemp "$shared_root/.postonce-prune-remove.XXXXXX")
release_plan=$(mktemp "$shared_root/.postonce-prune-plan.XXXXXX")

release_images "$current_release" >> "$keep_images"
if [ -n "$previous_release" ] && [ "$previous_release" != "$current_release" ]; then
  release_images "$previous_release" >> "$keep_images"
fi

# Validate every managed release before deleting any of them. Unexpected files,
# symlinks, owners, or manifests stop pruning instead of widening its scope.
for candidate in "$releases_root"/*; do
  if [ ! -e "$candidate" ] && [ ! -L "$candidate" ]; then
    continue
  fi
  candidate=$(validate_release_path "$candidate") || {
    printf '%s\n' "Unexpected entry in the PostOnce release root; refusing to prune." >&2
    exit 1
  }
  if [ "$candidate" = "$current_release" ] || \
     { [ -n "$previous_release" ] && [ "$candidate" = "$previous_release" ]; }; then
    continue
  fi
  candidate_images=$(release_images "$candidate") || exit 1
  api_image=$(printf '%s\n' "$candidate_images" | sed -n '1p')
  gateway_image=$(printf '%s\n' "$candidate_images" | sed -n '2p')
  printf '%s|%s|%s\n' "$candidate" "$api_image" "$gateway_image" >> "$release_plan"
done

while IFS='|' read -r candidate api_image gateway_image; do
  [ -n "$candidate" ] || continue
  rm -rf -- "$candidate"
  printf '%s\n%s\n' "$api_image" "$gateway_image" >> "$remove_images"
done < "$release_plan"

# Remove only image references belonging exclusively to deleted PostOnce
# releases. Docker preserves any shared base layers and refuses in-use images.
sort -u "$remove_images" | while IFS= read -r image; do
  [ -n "$image" ] || continue
  if grep -Fxq -- "$image" "$keep_images"; then
    continue
  fi
  if docker image inspect "$image" >/dev/null 2>&1 && \
     ! docker image rm "$image" >/dev/null 2>&1; then
    printf '%s\n' "Warning: retained an in-use PostOnce image: $image" >&2
  fi
done

printf '%s\n' "PostOnce release retention complete: current and immediate previous releases preserved."
