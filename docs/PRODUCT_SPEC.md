# PostOnce product specification

## Product definition

PostOnce is an exception-first daily-close workspace for dealership controllers. Its job is to make every processor payment accountable in the dealership system, surface only the decisions that require judgment, and let each location close with a durable attestation.

Payout and bank-deposit reconciliation is a related but separate workflow. PostOnce shows it beside operational close so a controller can understand both timelines without treating an unbatched processor payout as missing money or as a blocker to today's close.

This specification describes a synthetic evaluation product. Every organization, person, system, payment, repair order, payout, endpoint, and identifier is fictional. PostOnce does not process money and contains no real customer, cardholder, vehicle, bank, or credential data.

## Product promise

**Account for every payment. Resolve the uncertain ones. Close every location with proof.**

The product earns that promise when:

1. routine payments arrive already matched, posted, and verified;
2. the close board explains readiness separately for every location;
3. uncertain payments appear in a small, evidence-rich exception queue;
4. controller decisions use version and idempotency guards;
5. a blocker clears only after the dealership-system effect is verified;
6. closing a location creates an immutable attestation;
7. payout differences are reconciled with preserved source records and append-only adjustments;
8. recovery behavior remains inspectable without turning failures into product theater.

## Primary user and job

Maya Chen is Group Controller for the fictional Northline Motor Group. At the end of the business day she needs a trustworthy answer to three questions:

- Did every in-scope payment reach the right dealership record?
- Which uncertain items need her judgment before a location can close?
- Do later processor payouts agree with bank deposits, and if not, what evidence explains the difference?

Maya should not have to operate a webhook simulator, reason about distributed-systems terminology, or run a scripted story. Technical evidence stays one layer below the business record and appears when it helps explain an outcome.

## Canonical fixture

- Business date: Friday, September 4, 2026.
- Workspace time: 4:55 PM in `America/Edmonton`.
- Currency: CAD.
- Organization: Northline Motor Group.
- Locations: Northline Toyota, Northline Ford, and Northline Subaru.
- Friday payments: 62 total — 19 Toyota, 27 Ford, and 16 Subaru.
- Initial operational state: Toyota `READY`, Ford `BLOCKED`, Subaru `READY`.
- Current-day settlement state: `PAYOUT_PENDING` for all three locations and explicitly independent from close readiness.

Routine automation has already completed when the workspace opens. Duplicate delivery for `PAY-1006` and recovery from a lost DMS response for `PAY-1017` are historical evidence, not actions Maya has to run.

## Canonical operator journey

### 1. Orient from Close

The default route is `/app/close`. The board shows one row per location with payment count, verified DMS postings, open work, settlement context, and the close action. Ford is the only blocked location.

### 2. Work Ford's three exceptions

The Ford queue defaults to open items sorted newest first:

| Exception | Age at fixture time | Decision | Verified result |
| --- | ---: | --- | --- |
| `EX-104` | 18 minutes | Apply the $1,125.00 payment to `RO-8004`. | One human allocation and one verified DMS posting. |
| `EX-105` | 37 minutes | Link the $219.00 refund to the original payment for `P-18401`. | One immutable refund link and one verified DMS effect. |
| `EX-106` | 46 minutes | Apply the $2,450.00 second tender to `RO-8018`. | The existing $1,550.00 plus $2,450.00 exactly covers $4,000.00. |

Each decision page presents the source payment, evidence comparison, selected target, and the exact consequence of the write. A resolution is terminal only after the synthetic DMS confirms the effect. The open count and Ford readiness are recalculated from verified state, not optimistic UI state.

### 3. Close Ford

After all three postings verify, Ford becomes `READY` with 27 of 27 postings verified and zero blocking exceptions. Closing Ford requires the current close version and an idempotency key. The resulting `CLOSED` state preserves who closed it, when, the business date, and the counts attested to. Repeating the same command returns the original result; the attestation is not rewritten.

### 4. Reconcile Subaru's prior-day payout

The Deposits area includes `PAYOUT-9842` for Subaru on September 3:

```text
captured payments     $19,162.45
- refunds                $219.00
- processor fees         $200.84
= original expected   $18,742.61
- supported adjustment    $25.00
= adjusted expected   $18,717.61
  observed deposit    $18,717.61
  variance                 $0.00
```

The −$25.00 network assessment is supported by an immutable source record. Recording it appends an adjustment, retains the original expected value, and changes the payout from `VARIANCE` to `RECONCILED`. It does not change Ford's close or the current-day readiness of any location.

## Information architecture

| Route | Purpose |
| --- | --- |
| `/app/close` | Per-location operational readiness and close attestation. |
| `/app/exceptions` | Filtered queue of decisions requiring controller judgment. |
| `/app/exceptions/:id` | Source payment, candidate evidence, and guarded resolution. |
| `/app/payments` | Searchable and filterable payment ledger. |
| `/app/payments/:id` | Payment lifecycle, applied record, and contextual evidence. |
| `/app/deposits` | Processor payouts and bank observations. |
| `/app/deposits/:id` | Reconciliation arithmetic, source evidence, and adjustment. |
| `/app/activity` | Immutable human-readable audit events. |
| `/app/integrations` | Synthetic connection status and sanitized attempt evidence. |

The desktop product uses the six primary areas Close, Exceptions, Payments, Deposits, Activity, and Integrations. Mobile keeps the four most common areas in the bottom navigation and exposes the remaining context through More.

## Functional requirements

### Workspace and isolation

- Starting the product creates or resumes an isolated synthetic workspace.
- The browser supplies the workspace identifier in `X-Demo-Session`.
- Reset restores only the current workspace's deterministic fixture.
- An unavailable API disables all financial actions and presents a visible retry state.

### Exception resolution

- The queue supports location, status, ordering, and text filters.
- A decision requires an expected record version, idempotency key, and selected target.
- The target must belong to the same location and department when applicable.
- The amount must satisfy payment-remainder and record-balance constraints.
- Match, refund-link, and split-tender paths produce distinct immutable records.
- The exception remains blocking until its DMS write is verified.
- A stale version returns the winning state as a conflict instead of applying twice.

### Operational close

- Readiness is calculated per location.
- A location is `READY` only when every in-scope payment has a verified DMS effect and no blocking operational exception remains.
- Settlement state is displayed but is not used as an operational readiness gate.
- Close requires explicit confirmation and creates an immutable attestation.

### Payout reconciliation

- Processor calculations and bank observations remain identifiable source records.
- Reconciliation uses integer minor units and explicit signs.
- An adjustment requires a supported evidence record, expected version, fixed code/amount for this fixture, and idempotency key.
- The original expected payout is never overwritten.

### Evidence and audit

- Activity uses stable sequence, entity, actor, time, and correlation identifiers.
- Integration evidence contains allow-listed, bounded request and response fields.
- The payment detail can expose duplicate-delivery and response-recovery evidence in context.
- No secret, credential, stack trace, or real personal/payment data appears in public evidence.

## Non-negotiable invariants

1. Monetary values use integer minor units and an explicit three-letter currency.
2. Transport may deliver at least once; domain mutations remain idempotent.
3. An allocation cannot exceed the payment remainder or dealership-record balance.
4. A posting retry reuses its original operation key.
5. Accepted financial history is corrected by new records, never silent edits.
6. A location cannot become `READY` or `CLOSED` with an unverified in-scope posting or blocking operational exception.
7. Settlement status cannot make an otherwise complete operational close `BLOCKED`.
8. A payout cannot become `RECONCILED` with nonzero variance.
9. Accepted close attestations, refund links, settlement adjustments, and command receipts are append-only.
10. No AI output has authority to mutate financial state.
11. No PAN, CVV, real credential, or real customer record enters the system.

## Deliberately excluded

- Real card authorization, capture, refund, or money movement.
- Real DMS, processor, or bank integrations.
- Production authentication or tenant authorization.
- A generic chatbot or AI decision maker.
- A no-code workflow builder.
- Exactly-once network-delivery claims.
- Mobile-native applications.
- Treating settlement completion as a prerequisite for operational close.

## Acceptance criteria

- A first-time operator can identify the one blocked location from Close without instruction.
- The three Ford decisions are understandable from their business evidence.
- Ford becomes ready only after all three DMS writes verify.
- Closing Ford records one stable attestation and remains safe to replay.
- The Subaru adjustment preserves the original expected amount and produces zero variance.
- Duplicate delivery and lost-response recovery are discoverable as evidence, not presented as required work.
- Refresh resumes the same workspace; reset affects no other workspace.
- The product remains usable at supported desktop and narrow mobile widths.
- Automated validation passes from a clean clone with the documented toolchain.
