# PostOnce production operations

PostOnce runs as an isolated Docker Compose project behind the VPS's existing
host-level Caddy service. The public host Caddy is the only TLS endpoint. The
Compose gateway publishes only `127.0.0.1:18044`; PostgreSQL and the NestJS API
remain container-only.

The production stack deliberately contains only three services:

- PostgreSQL for durable synthetic demo state;
- the NestJS API, including the deterministic processor/DMS/bank simulations;
- a small Caddy gateway serving the static Vite build and proxying `/api/*`.

There is no separate worker or simulator container because the implemented demo
does not expose an independent process command. The API models outbox attempts
deterministically as part of reviewer-triggered actions.

The public demo is bounded to 500 stored sessions with a four-hour inactivity
cleanup horizon applied during admission, a 12-per-ingress-peer creation window
every ten minutes, and 120 mutations per session every ten minutes. In-memory
rate-limit bookkeeping retains at most 4,096 peer or session keys. The public host
overwrites `X-PostOnce-Ingress-Peer` from the actual TCP peer, the loopback gateway
removes caller-controlled IP aliases, and the API validates and hashes the
resulting address. Behind Cloudflare this intentionally groups by edge peer rather
than claiming authenticated end-user identity. The gateway also rejects request
bodies larger than 64 KB. These controls protect the shared VPS while preserving
an isolated reviewer run for every visitor.

Release images are built on GitHub Actions for `linux/amd64`, published to GHCR,
and addressed by immutable digest. CI never receives the VPS SSH key and never
deploys the server. An authorized local operator downloads the operations bundle,
uploads it with strict host-key checking, runs `preflight-vps.sh`, and then invokes
`deploy-release.sh` on the VPS.

The release gate runs the complete `npm run verify` suite, including PostgreSQL
integration checks and Playwright behavior/layout tests at the narrow supported
phone widths, before either production image can publish.

Persistent production data lives outside immutable releases:

- environment: `/opt/postonce/shared/postonce.env` (root-owned, mode `0600`);
- backups: `/opt/postonce/shared/backups/`;
- PostgreSQL: the `postonce_postgres_data` Docker volume.

The deployment owns only `/opt/postonce`, Compose project `postonce`, loopback
port `18044`, and `/etc/caddy/sites/postonce.caddy`. It never replaces the host
Caddyfile, edits firewall rules, or mutates another Compose project.

The current VPS needs `/etc/rook/caddy.env` loaded before validating the complete
host Caddy graph. Supply that file to preflight/deployment through
`POSTONCE_HOST_CADDY_ENV_FILE` when the default path differs. The file is sourced
in memory and is never copied or printed.

## Operator flow

1. Download the successful release workflow artifact.
2. Verify its `.sha256` sidecar.
3. Use `deploy-from-operator.ps1` with the already pinned SSH host, identity, and
   known-hosts file. It verifies the artifact checksum, forces batch mode,
   `IdentitiesOnly`, strict host-key checking, and a bounded connection timeout.
4. The operator script runs the read-only VPS preflight before deployment.
5. It deploys using the full source commit SHA as the release id:

```powershell
.\infra\scripts\deploy-from-operator.ps1 `
  -ArchivePath .\postonce-operations-<commit>.tgz `
  -ReleaseId <full-commit-sha> `
  -HostName <pinned-vps-host> `
  -IdentityPath <approved-identity-file>
```

Rollback requires an explicit existing release id and confirmation:

```sh
POSTONCE_HOST_CADDY_ENV_FILE=/etc/rook/caddy.env \
  sh /opt/postonce/current/infra/scripts/rollback-release.sh <release-id> --yes
```

Rollback changes application images and the current release symlink. It does not
reverse database migrations. Review migration compatibility before invoking it.

## One-time public-release steps

The deployment intentionally assumes anonymous, read-only pulls from public GHCR
packages; it never persists registry credentials on the shared VPS. After the
first workflow publication, set both `postonce-api` and `postonce-gateway` package
visibility to **Public** before running the operator deployment. If the packages
must remain private, design a separate least-privilege pull-token flow instead of
copying a broad GitHub token to the server.

Create the `postonce.swoop.video` DNS record in the existing Cloudflare zone using
the same reviewed origin target and proxy/TLS posture as the working sibling demo
hosts. DNS is deliberately outside the release artifact: neither the workflow nor
the server deployment receives a Cloudflare credential. After DNS and deployment,
verify the public `/`, `/healthz`, and `/api/health` endpoints before sharing the
demo.
