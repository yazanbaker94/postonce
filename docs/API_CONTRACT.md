# API contract

The web client stores a generated demo session identifier and sends it as `X-Demo-Session` after session creation. API responses use integer minor units and ISO 8601 timestamps.

## Health

- `GET /health`
- `GET /api/health`

## Demo sessions

- `POST /api/demo/sessions` — create and seed an isolated run.
- `GET /api/demo/state` — return the complete reviewer snapshot.
- `POST /api/demo/reset` — replace the caller's session with a clean run.
- `POST /api/demo/actions/:action` — execute the next deterministic chapter.

Supported actions:

- `process-routine`
- `deliver-duplicate`
- `simulate-lost-response`
- `open-ambiguous-exception`
- `simulate-resolution-race`
- `resolve-exception`
- `reconcile-settlement`
- `run-all`

Every chapter action is idempotent for a session. Repeating it returns the existing chapter result and does not duplicate mutations. Replaying an exception resolution with the same key is accepted only when the supplied payload is identical; a different payload receives `409 IDEMPOTENCY_KEY_REUSE`.

## Read models

- `GET /api/overview`
- `GET /api/payments`
- `GET /api/invoices`
- `GET /api/exceptions`
- `GET /api/integration-attempts`
- `GET /api/audit-events`
- `GET /api/architecture/evidence`

## Error model

```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "This exception was resolved by another operation.",
    "correlationId": "corr_demo_safe_value",
    "details": {}
  }
}
```

Expected statuses include `400`, `404`, `409`, `422`, `429`, and `503`. Integrity errors include `VERSION_CONFLICT`, `IDEMPOTENCY_KEY_REUSE`, `RESOLUTION_AMOUNT_MUST_EQUAL_PAYMENT_REMAINDER`, and `CLOSE_INCOMPLETE`. A bounded public-session mutation window returns `429 DEMO_MUTATION_RATE_LIMITED` with `Retry-After`. No stack trace or secret is returned to the browser.

## Snapshot shape

The exact shared TypeScript/Zod contract lives in `packages/contracts`. At minimum, state contains:

- session and current chapter;
- close status and reconciliation totals;
- independent processor-fee and bank-deposit evidence records;
- rooftops;
- invoices and payments;
- payment allocations;
- exceptions and candidates;
- integration attempts;
- audit events;
- invariant counters;
- benchmark and verification evidence.
