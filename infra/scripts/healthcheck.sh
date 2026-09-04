#!/bin/sh
set -eu

SCRIPT_HOME=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
# shellcheck source=common.sh
. "$SCRIPT_HOME/common.sh"

compose ps
compose exec -T api node -e "fetch('http://127.0.0.1:3001/api/health').then(async r=>{const b=await r.json();if(!r.ok||b.status!=='ok')process.exit(1);console.log('api ready:',b.persistence.mode)}).catch(()=>process.exit(1))"
compose exec -T gateway wget -q -O /dev/null http://127.0.0.1:8080/healthz
compose exec -T gateway wget -q -O /dev/null http://127.0.0.1:8080/api/health
compose exec -T gateway wget -q -O /dev/null http://127.0.0.1:8080/

for image_check in \
  "api|POSTONCE_API_IMAGE" \
  "gateway|POSTONCE_GATEWAY_IMAGE"
do
  service=${image_check%%|*}
  env_key=${image_check#*|}
  expected_image=$(read_env_value "$env_key")
  container_id=$(compose ps --quiet "$service")
  if [ -z "$expected_image" ] || [ -z "$container_id" ]; then
    printf '%s\n' "Missing immutable image evidence for PostOnce $service." >&2
    exit 1
  fi
  actual_image=$(docker inspect --format '{{.Config.Image}}' "$container_id")
  if [ "$actual_image" != "$expected_image" ]; then
    printf '%s\n' "Running PostOnce $service image does not match the release manifest." >&2
    exit 1
  fi
done
printf '%s\n' "PostOnce containers and PostgreSQL-backed API are healthy."
