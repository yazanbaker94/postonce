# PostOnce

**Account for every payment. Resolve the uncertain ones. Close every location with proof.**

PostOnce is an exception-first daily-close workspace for dealership controllers. It combines processor events, dealership-system posting status, operational exceptions, and later bank-deposit reconciliation without pretending those are one workflow. Routine payments stay out of the operator's way; uncertain postings become explicit work with evidence, version checks, and an audit trail.

This repository contains a synthetic evaluation product, not a payment processor. It does not authorize, capture, hold, or move money and is not affiliated with any dealership, DMS, processor, or bank. Every organization, person, payment, repair order, payout, endpoint, and identifier is fictional. No real customer, cardholder, vehicle, bank, or credential data is used.

![PostOnce daily-close workspace](docs/screenshots/product/01-close-initial.png)

## Open the product

- Product: [postonce.swoop.video](https://postonce.swoop.video)
- Case study: [postonce.swoop.video/case-study](https://postonce.swoop.video/case-study)
- Architecture: [postonce.swoop.video/architecture](https://postonce.swoop.video/architecture)

The root URL opens the product workspace and resolves to `/app/close`. `/case-study` preserves the project presentation, while `/demo` remains only as a compatibility redirect.

The browser creates an isolated synthetic workspace and keeps its identifier in local storage. A workspace-service failure leaves financial actions unavailable and visibly reports the problem; browser-only state is never presented as persisted evidence.

## Canonical operator journey

The stable fixture is Friday, September 4, 2026 at 4:55 PM Mountain Time. Maya Chen, Group Controller for the fictional Northline Motor Group, sees 62 Friday payments across Toyota, Ford, and Subaru.

1. Open **Close**. Toyota and Subaru are `READY`; Ford is `BLOCKED` by three operational exceptions. Current-day processor payouts are still pending, which is normal and does not block operational close.
2. Open Ford's exception queue, sorted newest first. Resolve `EX-104` by matching the $1,125.00 payment to `RO-8004`.
3. Resolve `EX-105` by linking the $219.00 refund to its original payment for `P-18401`.
4. Resolve `EX-106` by applying the $2,450.00 second tender to `RO-8018`, completing the $4,000.00 customer-pay total.
5. Each exception clears only after the synthetic dealership-system write is verified. Ford then becomes `READY` with 27 of 27 postings verified.
6. Close Ford. PostOnce records an immutable close attestation with the operator, time, business date, counts, and version.
7. Open Subaru's prior-day payout. Record the source-supported −$25.00 network-assessment adjustment. The original expected amount remains $18,742.61, adjusted expected and observed deposit both become $18,717.61, and the payout becomes `RECONCILED`.

The sequence is intentionally **Close → Exceptions → Close → Deposits**. Settlement evidence is monitored beside daily close, not wired in as a false prerequisite.

## Workspace map

| Area | Operator job |
| --- | --- |
| Close | See per-location readiness and seal an immutable close attestation. |
| Exceptions | Review only payments that deterministic rules cannot safely finish. |
| Payments | Inspect the payment ledger, DMS state, applied record, and evidence. |
| Deposits | Reconcile processor payouts to bank observations with append-only adjustments. |
| Activity | Read the human and system audit trail in reverse chronological order. |
| Integrations | Inspect sanitized attempts for the three fictional connected systems. |

Global search finds payments, dealership records, exceptions, and payouts without changing financial state.

## Safety model

- Money is stored as integer minor units with an explicit currency.
- At-least-once transport is expected; stable event and operation identities make financial mutations idempotent.
- An exception resolution is not complete until the DMS posting is verified.
- Expected versions prevent two stale operators from both winning the same decision.
- Cross-location, cross-department, over-allocation, and idempotency-key reuse are rejected.
- Close readiness is per location and depends on verified postings plus zero blocking operational exceptions.
- A close attestation, refund link, settlement adjustment, and command receipt are append-only evidence.
- Payout reconciliation has its own lifecycle; a pending payout or prior-day variance does not block today's operational close.

Duplicate delivery and a lost DMS response are represented as already-handled system behavior in the fixture. Their sanitized evidence is available from the relevant Payment, Activity, and Integrations views; they are not operator-facing simulation buttons.

## Repository map

```text
apps/web             React, Vite, and TypeScript product workspace
apps/api             NestJS REST API and synthetic system adapters
packages/contracts   Shared Zod schemas and TypeScript contracts
database             Explicit PostgreSQL migrations
docs                 Product, operator, architecture, API, and assurance notes
infra                Digest-pinned containers and shared-VPS release tooling
```

## Run locally

Requirements: Node.js 22.13 or newer and npm. PostgreSQL 17 is optional for normal development and required when validating the production persistence path.

```bash
npm ci
npm run dev:api
```

In a second terminal:

```bash
npm run dev:web
```

Open `http://localhost:5173/app/close`. The API listens on `http://localhost:3001`; Vite proxies `/api` and `/health` to it. With no `DATABASE_URL`, `DEMO_STORE=auto` selects process-local memory. That mode is disposable and is not a production persistence claim.

To exercise PostgreSQL locally, start a disposable PostgreSQL 17.11 container:

```powershell
docker run --rm --name postonce-dev-postgres -p 5432:5432 `
  -e POSTGRES_USER=postonce `
  -e POSTGRES_PASSWORD=postonce_dev `
  -e POSTGRES_DB=postonce `
  postgres:17.11-alpine
```

Then, in the API terminal:

```powershell
$env:DATABASE_URL = "postgresql://postonce:postonce_dev@127.0.0.1:5432/postonce"
$env:POSTONCE_TEST_DATABASE_URL = $env:DATABASE_URL
$env:DEMO_STORE = "postgres"
npm run migrate --workspace @postonce/api
npm run dev:api
```

## Test

```bash
npm run check
```

`check` runs workspace type checks, unit/API tests, and production builds. With `POSTONCE_TEST_DATABASE_URL` set, the API suite also exercises PostgreSQL locking and persistence. The full CI-equivalent gate installs Chromium and runs:

```bash
npm run verify
```

`verify` adds the Playwright product journey and responsive-layout checks. See [Test strategy](docs/TEST_STRATEGY.md) for focused commands and expected coverage.

## Deploy safely

Production images are built by GitHub Actions for `linux/amd64`, published to GHCR, and deployed by immutable digest. The shared VPS never builds application images. The operator artifact verifies its source commit and checksum, runs a read-only capacity/ownership preflight, and limits every change to `/opt/postonce`, Compose project `postonce`, loopback port `18044`, and one marked Caddy site file.

The release flow refuses to proceed unless all three protected AudioFetcher units are active, `/opt` has at least 12 GiB free, the host has at least 2 GiB total and 768 MiB currently available RAM, recent memory pressure is below the configured gate, and no OOM event or server-side application build is active. It also refuses ownership mismatches. It retains only the active and immediately previous PostOnce releases, prunes only unreferenced PostOnce images, and caps database backups by age and count. It never performs a global Docker prune. Rollback changes application images but does not reverse migrations.

Use the exact operator procedure in [infra/README.md](infra/README.md). Do not copy a working tree to the VPS or run `docker build` there.

## Read further

- [Product specification](docs/PRODUCT_SPEC.md)
- [Operator walkthrough](docs/OPERATOR_WALKTHROUGH.md)
- [API contract](docs/API_CONTRACT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Architecture decisions](docs/DECISIONS.md)
- [Failure matrix](docs/FAILURE_MATRIX.md)
- [Security and data boundaries](docs/SECURITY.md)
- [Test strategy](docs/TEST_STRATEGY.md)
- [Domain glossary](docs/DOMAIN_GLOSSARY.md)

## License

The source is available under the [MIT License](LICENSE).
