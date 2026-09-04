# Test strategy

PostOnce tests financial invariants, operator outcomes, persistence, and recovery behavior. Line coverage alone is not evidence that a close or reconciliation is safe.

All fixtures are deterministic and synthetic. Tests must never depend on real customer, cardholder, vehicle, dealership, DMS, processor, bank, or credential data.

## Fast domain and contract tests

The domain layer should prove:

- the canonical fixture has three locations and 62 Friday payments;
- Ford begins with exactly `EX-104`, `EX-105`, and `EX-106` open;
- match, refund-link, and split-tender decisions create the correct record type;
- an exception clears only after its DMS effect is verified;
- resolving each Ford exception decreases its blocker count exactly once;
- Ford becomes `READY` at 27 of 27 verified postings and zero blockers;
- current-day `PAYOUT_PENDING` does not prevent operational readiness or close;
- a close records one immutable attestation and an identical replay returns it;
- the Subaru −$25.00 adjustment preserves the original expected amount and produces zero variance;
- allocation, currency, location, department, record-type, and evidence constraints reject invalid input without partial mutation;
- changed payload under a used idempotency key is rejected;
- integer minor-unit arithmetic is exact.

Shared Zod schemas validate the API boundary and the complete `WorkspaceState` returned after every mutation.

## Repository and API tests

The HTTP and repository suites cover:

- isolated workspace creation, load, and reset;
- required/valid `X-Demo-Session` handling;
- the Close, Exceptions, Payments, Deposits, Activity, Integrations, Search, and evidence read routes;
- one success and one `409 VERSION_CONFLICT` for simultaneous commands against the same version;
- PostgreSQL serialization with `SELECT ... FOR UPDATE`;
- exact command replay and changed-payload collision behavior;
- normalized persistence of close attestations, refund links, payout source records, adjustments, integrations, and command receipts;
- processor duplicate delivery producing one payment mutation;
- recovery from a lost DMS response with the original operation key;
- sanitized error and evidence envelopes;
- create/mutation rate limits, session expiry/cap behavior, and forged-forwarding-header rejection;
- no cross-workspace read or mutation.

PostgreSQL-backed tests are the authority for locking, unique constraints, and persistence. In-memory tests provide fast feedback but are not accepted as the only evidence for concurrency or durability.

## Interface tests

Component tests verify that:

- the root entry resolves directly into the `/app/close` product workspace;
- retired and unknown public paths resolve into the product workspace;
- the product boots from the workspace service rather than a browser-mutated fixture;
- the close board separates operational readiness from settlement status;
- the six desktop navigation areas and responsive mobile navigation remain reachable;
- an unavailable service leaves financial actions disabled and presents retry state;
- version conflicts reload and explain the winning record;
- evidence disclosure and confirmation controls are keyboard accessible;
- narrow layouts do not clip tables, decision cards, or primary actions.

## Browser journey

The Playwright journey follows the same path an operator does:

1. create or reset an isolated workspace at `/app/close`;
2. confirm Toyota and Subaru are ready while Ford has three blockers;
3. resolve `EX-104` to `RO-8004` and observe verified completion;
4. link `EX-105` to the original `P-18401` payment;
5. complete the `EX-106` split tender on `RO-8018`;
6. confirm Ford becomes ready, then close it and inspect the attestation;
7. record the source-supported adjustment on `PAYOUT-9842`;
8. confirm adjusted expected and observed deposit are $18,717.61 with zero variance;
9. refresh and confirm state survives;
10. create another workspace and confirm isolation;
11. inspect console errors, failed requests, and desktop/narrow layout overflow.

Browser tests use the implemented business endpoints and never depend on scripted action state.

## Local commands

Install the locked dependency graph:

```bash
npm ci
```

Run the default repository gate:

```bash
npm run check
```

This runs workspace type checks, tests, and production builds. Focused commands are:

```bash
npm run typecheck
npm run test
npm run build
npm run test --workspace @postonce/api
npm run test --workspace @postonce/web
```

To include the PostgreSQL repository test, start PostgreSQL, apply migrations, and expose the test URL before running the API suite:

```powershell
$env:DATABASE_URL = "postgresql://postonce:postonce_dev@127.0.0.1:5432/postonce"
$env:POSTONCE_TEST_DATABASE_URL = $env:DATABASE_URL
$env:DEMO_STORE = "postgres"
npm run migrate --workspace @postonce/api
npm run test --workspace @postonce/api
```

Install Chromium once, then run the CI-equivalent gate:

```bash
npx playwright install chromium
npm run verify
```

`verify` runs `check` and the product browser suite. CI also provisions PostgreSQL 17, exports both database URLs, applies migrations, and installs Chromium with system dependencies.

## Production verification

After deployment, verify the product contract instead of a scripted failure runner:

1. fetch `/`, `/healthz`, and `/api/health` through the public TLS origin;
2. assert health reports PostgreSQL persistence and synthetic-only data;
3. create a workspace and load `/api/workspace` with its session header;
4. execute the three Ford resolution commands, close Ford, and record the Subaru adjustment;
5. assert verified posting counts, immutable attestation, preserved original payout, and zero adjusted variance;
6. replay accepted commands and confirm no counts or evidence duplicate;
7. refresh and confirm persistence, then create a second workspace and confirm isolation;
8. test desktop and supported narrow viewports with no console/network failures;
9. confirm the sibling AudioFetcher public health and release identity are unchanged.

Production verification uses only the synthetic fixture and must not create real payment or customer data.
