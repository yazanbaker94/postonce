# Operator walkthrough

This walkthrough follows the product's normal operator flow and implemented business commands.

All people, locations, payments, records, and connected systems are synthetic. PostOnce does not move money and this environment contains no real customer or cardholder data.

## Before the walkthrough

Open `/app/close`. If the workspace is already changed, open Maya Chen's profile menu and choose **Reset workspace**. Reset affects only the current isolated browser workspace.

The fixture should read Friday, September 4 at 4:55 PM Mountain Time and show:

- 62 Friday payments across three locations;
- Toyota `READY`;
- Ford `BLOCKED` with three exceptions and 24 of 27 DMS postings verified;
- Subaru `READY`;
- current-day settlement `PAYOUT_PENDING` without blocking any ready location;
- one prior-day payout variance.

## Product walkthrough

### 1. Start with the daily-close board

Use the Ford row to explain the operating model: payments are in scope, three dealership-system effects still await controller decisions, and those three exceptions are the only reason Ford cannot close.

Point out that the settlement column says payout pending while Toyota and Subaru are ready. Operational proof controls today's close; payout reconciliation happens on its own timeline.

Choose **Review exceptions** on Ford.

### 2. Resolve `EX-104` — ambiguous match

The queue is filtered to Northline Ford, open work, newest first. Open `EX-104`.

Compare the two repair orders. `RO-8004` has the exact $1,125.00 amount, same customer, same location and department, and closed six minutes before the payment. `RO-8031` differs by $25.00 and is still open.

Keep `RO-8004` selected and choose **Apply $1,125.00 to RO-8004**. The completed state must say the dealership-system write is verified. Only then is the exception resolved.

### 3. Resolve `EX-105` — refund link

Return to Exceptions and open `EX-105`.

The −$219.00 refund has no verified original transaction. Compare the two historical candidates and select `P-18401`, whose customer, department, and amount agree exactly.

Choose **Link $219.00 refund to P-18401**. PostOnce records a refund link under a stable operation identity, verifies the DMS effect, and clears the blocker without rewriting the historical payment.

### 4. Resolve `EX-106` — split tender

Return to Exceptions and open `EX-106`.

`RO-8018` has a $4,000.00 customer-pay total. An earlier $1,550.00 Visa payment is already applied; the new $2,450.00 Mastercard payment is the exact remainder.

Choose **Apply $2,450.00 remainder to RO-8018**. The resulting allocation completes the record, uses one stable operation key, and is not terminal until the posting is verified.

### 5. Close Ford

Return to Close. Ford should now show:

- 27 payments received;
- 27 of 27 DMS postings verified;
- no blockers;
- status `READY`;
- current-day payout still pending and explicitly independent.

Choose **Close location**, inspect the confirmation summary, and confirm. Ford becomes `CLOSED` with an immutable attestation naming Maya Chen and preserving the counts and version she closed.

### 6. Reconcile Subaru's prior-day payout

Open Deposits and choose Subaru's September 3 payout, `PAYOUT-9842`.

Read the evidence from source to result:

- captured payments: $19,162.45;
- refunds: −$219.00;
- processor fees: −$200.84;
- original expected payout: $18,742.61;
- observed bank deposit: $18,717.61;
- unexplained variance: $25.00;
- network-assessment source notice: −$25.00.

Optionally add a controller note, then choose **Record −$25.00 network assessment adjustment**. The payout becomes `RECONCILED`, adjusted expected equals observed at $18,717.61, and the original expected value remains visible.

## Evidence worth opening

- In Payments, open `PAY-1006` to trace a duplicated processor delivery that produced one financial mutation.
- Open `PAY-1017` to inspect the response-recovery evidence seam: the DMS committed, the response was lost, and retry with the same operation key found the existing posting.
- In Activity, show the controller resolutions, verified writes, close attestation, and settlement adjustment in sequence.
- In Integrations, show sanitized attempts grouped under the fictional DMS, processor, and bank connections.

These are explanations of system behavior already handled by PostOnce. The operator does not create failures to prove that the system can survive them.

## Technical discussion

- REST commands express the three business mutations directly: resolve an exception, close a location, and record a settlement adjustment.
- The API validates shared Zod contracts, versions, idempotency keys, amount/currency rules, location/department boundaries, and evidence identity.
- Processor inbox identity absorbs repeat delivery. Posting outbox identity makes an uncertain retry converge on one DMS effect.
- PostgreSQL locks the workspace aggregate during a mutation; a stale contender receives `409 VERSION_CONFLICT` with the winning context.
- Operational close and payout reconciliation deliberately have separate state machines.
- Session headers isolate anonymous synthetic workspaces but are not production authentication.
