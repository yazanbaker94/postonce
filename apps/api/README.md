# PostOnce API

The API is the NestJS/TypeScript backend for PostOnce's dealership payment workspace. It serves the operational close, exception-resolution, payment-evidence, deposit-reconciliation, activity, and integration projections used by the product UI. The public environment uses fictional adapters and synthetic data only.

## What is real

- each public reviewer gets a UUID-isolated session;
- money is represented as integer CAD cents;
- processor delivery identities, allocation operation keys, outbox operation keys, and destination posting keys are unique;
- the PostgreSQL adapter locks the session aggregate with `SELECT ... FOR UPDATE`;
- snapshot and relational evidence rows commit in one transaction;
- integration attempts and audit events are append-only;
- the HTTP race test sends two resolution commands at version 1 and observes one `200` and one `409`;
- the same destination key recovers a commit whose response was lost;
- operational close becomes available when the posting exception is resolved; payout settlement is tracked independently and can be reconciled later with signed adjustments and evidence.

## What is simulated

Northstar Processor, LegacyDMS, Prairie Bank, Northline Motor Group, people, repair orders, responses, and failure injection are fictional deterministic fixtures. PostOnce does not process money and does not claim exactly-once network delivery. It proves idempotent mutation under at-least-once delivery.

## Run locally

```sh
npm run dev:api
```

With PostgreSQL:

```sh
DATABASE_URL=postgres://... npm run migrate --workspace @postonce/api
DATABASE_URL=postgres://... DEMO_STORE=postgres npm run start:dev --workspace @postonce/api
```

Verification:

```sh
npm run typecheck --workspace @postonce/api
npm run test --workspace @postonce/api
npm run benchmark --workspace @postonce/api
npm run build --workspace @postonce/api
```

Set `POSTONCE_TEST_DATABASE_URL` to a migrated disposable database to enable the real PostgreSQL lock/constraint suite. The default suite always runs the engine, HTTP contract, simultaneous resolution race, idempotency, narrative consistency, and session-bound tests.

## Public-demo bounds

Session creation is rate-limited by a hashed, validated ingress-peer address supplied by the private proxy boundary. Public forwarding headers are ignored. Expired sessions are rejected on reads and mutations, are opportunistically pruned during admission, and the stored-session count is capped. PostgreSQL cleanup and admission use an advisory transaction lock so concurrent creation cannot race past the cap. See `.env.example` for controls.
