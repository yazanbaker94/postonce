# PostOnce product specification

PostOnce is an independent engineering case study. It is not affiliated with, commissioned by, or connected to Anchorbase, DealerTrack, a payment processor, or any real dealership. Every person, account, transaction, endpoint, credential, and payment token is synthetic.

## Product thesis

Every payment should post once. Every uncertainty should remain explainable.

The demo proves how a payment-integration layer can coordinate a system of record, a payment processor, and a bank settlement feed without silently losing or duplicating financial state.

## Reviewer promise

Within 90 seconds, a reviewer can see:

1. routine payments match and post without manual work;
2. a duplicated processor webhook changes financial state only once;
3. a downstream system commits a posting but loses the response, and a safe retry returns the original result;
4. the guided run shows two same-version resolution outcomes and only one winning decision, while the test suite submits the genuinely concurrent commands;
5. an ambiguous split payment is escalated rather than guessed;
6. gross payments, fees, refunds, and the net bank deposit reconcile before close;
7. every decision and integration attempt remains traceable.

## Primary persona and scenario

Maya Chen is the controller for Northline Motor Group, a fictional two-rooftop dealership. At 4:55 PM on the last business day of the month, she needs to know whether the day can close.

PostOnce receives synthetic repair-order invoices from LegacyDMS, payment events from Northstar Processor, and settlement records from Prairie Bank. Most activity clears automatically. Maya reviews only the exceptions that cannot be resolved deterministically.

## Guided demo chapters

### 00 — Start of close

- Two rooftops.
- Twelve payment events.
- Gross, fee, refund, and expected-deposit totals.
- Close status is `PROCESSING`.

### 01 — Routine automation

- Exact repair-order references match in constant expected time through indexed lookup.
- Successful matches create immutable allocations and enqueue a DMS posting in the same database transaction.
- No reviewer action is needed.

### 02 — Duplicate event

- The same processor event is delivered twice.
- A unique `(provider, external_event_id)` constraint and idempotent consumer accept one mutation.
- Both delivery attempts remain visible.

### 03 — Lost response after commit

- LegacyDMS stores posting `OP-7Q3K`, but the HTTP response is intentionally lost.
- The retry reuses the same destination idempotency key and retrieves the original result.
- One DMS posting exists, even though two attempts occurred.

### 04 — Ambiguous allocation

- A customer payment could apply to two similarly valued repair orders.
- Deterministic rules cannot cross the confidence threshold.
- The system opens an exception with evidence and candidate explanations.
- An optional assistant may explain the candidates, but it cannot write to the ledger.

### 05 — Concurrent decision

- Two simulated controllers submit a resolution using the same version.
- One succeeds. One receives a version conflict and the winning decision.
- The accepted allocation is not duplicated.
- The public chapter deterministically replays both outcomes; separate HTTP and PostgreSQL tests exercise genuinely concurrent commands.

### 06 — Settlement close

- Gross captures are derived from payment events and the fee comes from an independent processor record.
- An independent bank-deposit record matches the expected net amount.
- The close status becomes `READY` only after all blocking exceptions are resolved.

## Non-negotiable invariants

1. Monetary values use integer minor units and an explicit currency.
2. Transport may deliver at least once; domain mutations remain idempotent.
3. A payment allocation cannot exceed either the payment remainder or invoice balance.
4. A posting retry must reuse its original operation key.
5. Financial history is corrected with reversing events, never silent edits.
6. An unresolved blocking variance prevents close.
7. AI output is advisory only and cannot mutate financial state.
8. No PAN, CVV, real credential, or real customer record enters the system.
9. Every external attempt includes a correlation identifier and sanitized request/response evidence.

## Scope

### Required

- React + TypeScript + Vite reviewer experience.
- NestJS REST API.
- PostgreSQL persistence with explicit migrations.
- Session-isolated public demos.
- Processor, DMS, and bank simulators.
- Transactional outbox/inbox behavior.
- Deterministic matching and human exception resolution.
- Unit, integration, race, and browser tests.
- A reproducible benchmark with synthetic data.
- Docker-based production deployment.
- Reviewer-facing architecture and tradeoff documentation.

### Deliberately excluded

- Real payment processing.
- Real financial institution or DMS integrations.
- Cardholder data.
- Android or iOS applications.
- A generic chatbot.
- A broad no-code workflow builder.
- Claims of exactly-once delivery across distributed systems.

## Success criteria

- The guided flow is understandable without financial expertise.
- Refreshing the page preserves an isolated run.
- Reset creates a clean isolated run without affecting other reviewers.
- All four failure scenarios are deterministic and repeatable.
- The public site stays useful when the API is temporarily unavailable.
- Automated checks pass from a clean clone.
- Documentation explains the design well enough for the author to defend every choice in an interview.
