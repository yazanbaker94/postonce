# PostOnce

[![CI](https://github.com/yazanbaker94/postonce/actions/workflows/ci.yml/badge.svg)](https://github.com/yazanbaker94/postonce/actions/workflows/ci.yml)

[Try PostOnce](https://postonce.swoop.video) · [All 24 screenshots](docs/SCREENSHOTS.md) · [Explore the code](docs/REVIEWER_GUIDE.md) · [Architecture](docs/ARCHITECTURE.md)

**Account for every payment. Resolve the uncertain ones. Close every location with proof.**

PostOnce helps a dealership accounting team answer three questions: **Was every payment recorded correctly? What still needs a decision? Did the expected money reach the bank?**

It brings payment records, dealership-system postings, exceptions, and bank-deposit reconciliation into one workspace. The normal path stays quiet; uncertain items come with evidence and a specific next action. Every accepted decision leaves a traceable record.

Built end to end with **TypeScript, React, Vite, NestJS, Zod, and PostgreSQL**, with automated browser tests and a containerized deployment.

This repository contains a synthetic evaluation product, not a payment processor. It does not authorize, capture, hold, or move money and is not affiliated with Anchorbase or any dealership, DMS, processor, or bank. All business data and external-system identities are fictional. No real customer, cardholder, vehicle, bank, or financial-system credential data is used.

## The problem

A customer payment, its entry in the dealership management system (DMS), and the eventual bank deposit are different records on different timelines. A missing repair-order reference, an unlinked refund, or a split payment can leave the accounting team uncertain about whether the day's work is complete.

PostOnce separates **operational close** from **bank settlement**. The team can finish today's verified posting work without falsely claiming that a pending payout has arrived. When a deposit differs from expectations, a supported adjustment explains the difference without overwriting the original facts.

## Product screens

All six main sections are previewed below. Click a screenshot to open the full-size image. The [complete 24-image tour](docs/SCREENSHOTS.md) also includes each exception decision, expanded payment evidence, settlement workpapers, completed states, search, and mobile layouts.

| Daily close | Exceptions |
| --- | --- |
| [![Daily close across three locations](docs/screenshots/review/01-close.png)](docs/screenshots/review/01-close.png) | [![Ford's three blocking exceptions](docs/screenshots/review/02-exceptions.png)](docs/screenshots/review/02-exceptions.png) |
| **Payments** | **Deposits** |
| [![Payment ledger](docs/screenshots/review/06-payments.png)](docs/screenshots/review/06-payments.png) | [![Deposit ledger](docs/screenshots/review/10-deposits.png)](docs/screenshots/review/10-deposits.png) |
| **Activity** | **Integrations** |
| [![Human and system activity](docs/screenshots/review/20-activity.png)](docs/screenshots/review/20-activity.png) | [![Connected simulators and recent attempts](docs/screenshots/review/14-integrations.png)](docs/screenshots/review/14-integrations.png) |

### Inside a decision

Compare the evidence, select the correct repair order, and verify the posting before the exception clears.

[![Ambiguous payment match decision](docs/screenshots/review/03-payment-match.png)](docs/screenshots/review/03-payment-match.png)

### Payment evidence and settlement reconciliation

Technical detail stays attached to the business record it explains. On the left, the same posting identity recovers a lost response without a second effect. On the right, source evidence supports the $25 payout adjustment.

| Verified posting recovery | Evidence-backed deposit adjustment |
| --- | --- |
| [![Lost-response recovery with one financial effect](docs/screenshots/review/08-payment-recovery.png)](docs/screenshots/review/08-payment-recovery.png) | [![Subaru deposit variance and supporting evidence](docs/screenshots/review/11-deposit-variance.png)](docs/screenshots/review/11-deposit-variance.png) |

### Responsive by design

The same workflows remain available on a phone. Payment rows become labeled records, and candidate comparisons fit the available width.

| Mobile close | Mobile payments | Mobile comparison |
| --- | --- | --- |
| [![Mobile close board](docs/screenshots/review/22-mobile-close.png)](docs/screenshots/review/22-mobile-close.png) | [![Mobile payment records](docs/screenshots/review/23-mobile-payments.png)](docs/screenshots/review/23-mobile-payments.png) | [![Mobile repair-order comparison](docs/screenshots/review/24-mobile-decision.png)](docs/screenshots/review/24-mobile-decision.png) |

## Try the complete workflow

Open the [live demo](https://postonce.swoop.video): no signup or installation is required. You act as Maya Chen, controller for the fictional Northline Motor Group, reviewing 62 Friday payments across Toyota, Ford, and Subaru. All fixture amounts are CAD.

1. Open **Close**. Toyota and Subaru are `READY`; Ford is `BLOCKED` by three operational exceptions. Current-day processor payouts are still pending, which is normal and does not block operational close.
2. Open Ford's exception queue, sorted newest first. Resolve `EX-104` by matching the $1,125.00 payment to `RO-8004`.
3. Resolve `EX-105` by linking the $219.00 refund to its original payment for `P-18401`.
4. Resolve `EX-106` by applying the $2,450.00 second tender to `RO-8018`, completing the $4,000.00 customer-pay total.
5. Each exception clears only after the synthetic dealership-system write is verified. Ford then becomes `READY` with 27 of 27 postings verified.
6. Close Ford. PostOnce records an immutable close attestation with the operator, time, business date, counts, and version.
7. Open Subaru's prior-day payout. Record the source-supported −$25.00 network-assessment adjustment. The original expected amount remains $18,742.61, adjusted expected and observed deposit both become $18,717.61, and the payout becomes `RECONCILED`.

The sequence is intentionally **Close → Exceptions → Close → Deposits**. Settlement evidence is monitored beside daily close, not wired in as a false prerequisite.

To start again, use **Maya Chen's profile → Reset workspace**. Your browser has its own anonymous synthetic workspace; resetting it does not reset another visitor's work. The demo opens on September 4, 2026 at 4:55 PM Mountain Time, and the displayed controller is a fictional persona, not an authenticated user.

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

## Engineering approach

### Architecture

```mermaid
flowchart LR
    UI[React operator workspace] <-->|Validated REST contracts| API[NestJS command boundary]
    API <-->|Transactions and version checks| DB[(PostgreSQL)]
    Processor[Processor simulator] -->|Payment and refund events| API
    API <-->|Posting and verification| DMS[DMS simulator]
    Bank[Bank-feed simulator] -->|Deposit observations| API
```

The browser displays state returned by the API rather than treating a button click as a successful financial operation. Shared Zod schemas validate the boundary. PostgreSQL persists workspace state and normalized business evidence transactionally. External connections are deterministic simulators, making the demonstrated failure cases reproducible without proprietary access.

| Layer | Technology | Responsibility |
| --- | --- | --- |
| Interface | React, TypeScript, Vite | Responsive workflows, evidence review, search, and explicit confirmations. |
| API | NestJS, Zod | Business commands, validation, safe error responses, and state projections. |
| Persistence | PostgreSQL, SQL migrations | Transactions, constraints, concurrency control, and retained evidence. |
| Verification | Vitest, API tests, Playwright | Domain rules, invalid commands, replay, persistence, and browser journeys. |
| Delivery | GitHub Actions, Docker, Caddy, Cloudflare | Verified image builds, digest-pinned deployment, and public routing. |

### Correctness rules

- Money is stored as integer minor units with an explicit currency.
- At-least-once transport is expected; stable event and operation identities make financial mutations idempotent.
- An exception resolution is not complete until the DMS posting is verified.
- Expected versions prevent two stale operators from both winning the same decision.
- Cross-location, cross-department, over-allocation, and idempotency-key reuse are rejected.
- Close readiness is per location and depends on verified postings plus zero blocking operational exceptions.
- A close attestation, refund link, settlement adjustment, and command receipt are append-only evidence.
- Payout reconciliation has its own lifecycle; a pending payout or prior-day variance does not block today's operational close.

Duplicate delivery and a lost DMS response are represented as already-handled system behavior in the fixture. Their sanitized evidence is available from the relevant Payment, Activity, and Integrations views; they are not operator-facing simulation buttons.

### Deliberate tradeoffs

- **Explicit commands instead of arbitrary updates:** resolve an exception, close a location, and record a supported adjustment each have a narrow validation boundary.
- **PostgreSQL before more infrastructure:** one transactional boundary keeps the demo inspectable. The outbox is modeled, but an independent worker is not claimed.
- **Deterministic evidence before AI:** the fixture exposes bounded candidates and the reasons behind them. No model has authority to choose a financial target or move money.
- **Versions plus serialized writes:** a stale operator receives a conflict rather than silently overwriting the accepted decision.

The [architecture notes](docs/ARCHITECTURE.md), [decision record](docs/DECISIONS.md), and [code reading map](docs/REVIEWER_GUIDE.md#suggested-code-reading-order) explain these choices in more depth.

## What is implemented—and what is not

**Working application:** API-backed decisions, PostgreSQL persistence in the deployment, runtime-validated contracts, command replay, stale-version rejection, audit records, source-preserving settlement adjustments, and the end-to-end operator workflow.

**Simulated environment:** the customers, controller identity, processor/DMS/bank connections, incoming events, candidate sets, and recovery scenarios. The demo is not a measured production matching engine or a live Anchorbase integration.

**Production work remains:** authentication and tenant authorization, actual integration contracts and signed webhooks, independently leased background execution, operational monitoring, security review, and applicable compliance controls. Anonymous workspace isolation is not authentication, and no production-readiness or compliance certification is claimed. See [security boundaries](docs/SECURITY.md).

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

## Verification

The suite covers successful decisions and rejected ones: invalid allocations, reused operation keys with changed payloads, stale concurrent commands, workspace isolation, and preserved settlement arithmetic. Browser tests exercise the complete close/reconciliation journey plus desktop and mobile layouts.

The reviewer release passed **21 browser tests**, alongside API/domain and component tests. GitHub CI also provisions PostgreSQL to exercise the persistence path; local runs without a test database skip that database-specific check. The badge above links to the current CI result.

```bash
npm run check
```

`check` runs workspace type checks, unit/API tests, and production builds. With `POSTONCE_TEST_DATABASE_URL` set, the API suite also exercises PostgreSQL locking and persistence. For the browser suite, install Chromium once and run:

```bash
npx playwright install chromium
npm run verify
```

`verify` adds the Playwright product journey and responsive-layout checks. See [Test strategy](docs/TEST_STRATEGY.md) for focused commands and expected coverage.

To reproduce the README/gallery images with the local API and web app running:

```bash
npm run screenshots:review
```

These captures use actual UI interactions in a fresh synthetic workspace, not mocked page states.

## Deployment

GitHub Actions verifies the repository before publishing application images. The deployment uses immutable image digests, a private database network, health checks, and a bounded rollback history. Images are built off-server; deployment checks resource capacity and limits changes to the application's own boundary.

The [operations guide](infra/README.md) contains the detailed release, capacity, backup, and rollback procedures.

## Read further

- [Product specification](docs/PRODUCT_SPEC.md)
- [Reviewer guide and code reading order](docs/REVIEWER_GUIDE.md)
- [Full screenshot tour](docs/SCREENSHOTS.md)
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
