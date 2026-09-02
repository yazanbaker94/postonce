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
printf '%s\n' "PostOnce containers and PostgreSQL-backed API are healthy."
