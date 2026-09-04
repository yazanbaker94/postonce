# API contract

PostOnce exposes a command-oriented REST API under `/api`. The browser creates an isolated synthetic workspace, stores its UUID locally, and supplies it as `X-Demo-Session` on every workspace read or mutation.

All amounts are integer minor units, currencies are three-letter uppercase codes, business dates use `YYYY-MM-DD`, and event times use ISO 8601. Exact runtime schemas live in `packages/contracts` and are authoritative.

## Health

| Method | Route | Session required | Purpose |
| --- | --- | --- | --- |
| `GET` | `/health` | No | Direct service readiness. |
| `GET` | `/api/health` | No | Same readiness response through the public API path. |

A healthy response reports `status: "ok"`, service identity, persistence mode/health, current time, and `syntheticDataOnly: true`. Dependency failure returns HTTP `503` with `status: "degraded"`.

## Workspace lifecycle

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/demo/sessions` | Create and seed an isolated workspace. |
| `GET` | `/api/workspace` | Read the complete workspace snapshot. |
| `POST` | `/api/demo/reset` | Restore the caller's workspace to the canonical fixture. |

Session creation does not require a session header. It returns:

```json
{
  "sessionId": "00000000-0000-4000-8000-000000000000",
  "sessionHeader": "X-Demo-Session",
  "state": {}
}
```

Reset preserves the workspace UUID and original creation time, replaces only that workspace's state, and returns the same envelope. `GET /api/demo/state` remains a compatibility alias for `GET /api/workspace`.

## Close

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/close` | List per-location close projections and summary counts. |
| `GET` | `/api/close/:rooftopId` | Read one location's close, payments, blockers, and current-day settlement context. |
| `POST` | `/api/close/:rooftopId/close` | Seal one ready location's immutable close attestation. |

`rooftopId` accepts the fixture ID or its location code on read projections. A close command body is:

```json
{
  "expectedVersion": 4,
  "idempotencyKey": "close-ford-2026-09-04-request-01"
}
```

The command rejects stale versions and any location that still has an unverified in-scope posting or blocking operational exception. Settlement may be `PAYOUT_PENDING`; it is context, not a close gate. The accepted attestation cannot be overwritten. `GET /api/overview` is a compatibility alias for `GET /api/close`.

## Exceptions

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/exceptions` | List exception projections. |
| `GET` | `/api/exceptions/:exceptionId` | Read payment, candidates, related allocations, and refund links. |
| `POST` | `/api/exceptions/:exceptionId/resolve` | Apply a guarded controller decision and verify its DMS effect. |

List filters are optional:

- `location`: location ID or code;
- `status`: `OPEN` or `RESOLVED`;
- `sort`: `newest`, `oldest`, `amount-high`, or `amount-low`;
- `q`: case-insensitive text search.

A resolution body is:

```json
{
  "expectedVersion": 1,
  "idempotencyKey": "resolve-ex-104-ro-8004-request-01",
  "targetId": "rec_ro_8004"
}
```

The same endpoint supports all three implemented decision types:

- match a payment to a DMS record;
- link a refund to its original payment;
- apply the remaining split tender to a DMS record.

The target must be an offered candidate and satisfy location, department, amount, balance, and record-type invariants. PostOnce creates the correct allocation or refund-link record, writes with a stable operation key, verifies the synthetic DMS result, and only then marks the exception resolved and recalculates location readiness.

## Payments

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/payments` | List payment projections. |
| `GET` | `/api/payments/:paymentId` | Read one payment with its record, allocation/refund link, inbox/outbox, attempt, and audit evidence. |

List filters are `location`, `department`, `dmsState`, and `q`. Results sort newest first. Search covers payment ID, processor reference, customer label, source reference, last four synthetic digits, and location.

## Deposits

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/deposits` | List processor payouts with their location and reconciliation projection. |
| `GET` | `/api/deposits/:payoutId` | Read payout arithmetic, immutable source records, and adjustments. |
| `POST` | `/api/deposits/:payoutId/adjustments` | Append a supported settlement adjustment. |

The canonical fixture permits one evidence-backed network-assessment adjustment:

```json
{
  "expectedVersion": 1,
  "idempotencyKey": "adjust-payout-9842-network-assessment-01",
  "amountCents": -2500,
  "code": "NETWORK_ASSESSMENT",
  "evidenceRecordId": "source_assessment_9842",
  "note": "Optional controller context"
}
```

The API requires the matching immutable evidence record, preserves `originalExpectedCents`, calculates `adjustedExpectedCents`, and permits `RECONCILED` only at zero variance. An adjustment cannot alter operational close state.

## Activity, integrations, search, and evidence

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/activity` | Read audit events newest first. |
| `GET` | `/api/integrations` | Read simulated connection status and recent sanitized attempts. |
| `GET` | `/api/search?q=...` | Search payments, exceptions, DMS records, and deposits. |
| `GET` | `/api/architecture/evidence` | Read topology, persistence, fixture, and invariant evidence. |

Search returns no items until the trimmed query contains at least two characters. `GET /api/audit-events` and `GET /api/integration-attempts` are compatibility aliases for Activity and Integrations.

## Mutation response and replay

Every successful mutation returns the complete current state so the client does not infer a financial outcome:

```json
{
  "replayed": false,
  "result": {},
  "state": {}
}
```

The idempotency key is scoped to its command. Repeating the exact accepted payload returns the original result with `replayed: true`. Reusing the key with changed input returns `409 IDEMPOTENCY_KEY_REUSE`. A stale `expectedVersion` returns `409 VERSION_CONFLICT`; it never creates a second allocation, refund link, close, or adjustment.

## Error envelope

```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "This record changed before the command was accepted.",
    "correlationId": "corr_safe_public_value",
    "details": {}
  }
}
```

Expected statuses include `400`, `404`, `409`, `422`, `429`, and `503`. Public errors contain a stable code, safe message, correlation ID, and bounded details. They never contain a stack trace, credential, environment value, database address, or unsanitized upstream response.

Missing or invalid workspace headers produce `DEMO_SESSION_REQUIRED`, `INVALID_DEMO_SESSION`, or `DEMO_SESSION_NOT_FOUND`. Admission and mutation windows return `429` with bounded retry details.

## Workspace snapshot

The `WorkspaceState` contract includes:

- metadata, user, session, and three locations;
- DMS records, payments, allocations, and refund links;
- operational exceptions and candidate evidence;
- processor inbox, posting outbox, and sanitized integration attempts;
- audit events and per-location operational closes;
- processor payouts, settlement source records, and append-only adjustments;
- synthetic integration connections, command receipts, and invariant counters.

The public write surface is limited to exception resolution, location close, settlement adjustment, and workspace reset.
