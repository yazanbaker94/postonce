# PostOnce — Product-First Implementation Blueprint

## Status

**Binding implementation brief for the next PostOnce build pass.**

This replaces the current “guided technical demo” product experience with a believable dealership payment-operations product.

The backend correctness work is **not** thrown away. The primary change is what the application considers important and what the operator actually sees.

---

# 1. Product thesis

PostOnce is an **exception-first payment operations and daily-close workspace** for a fictional dealership group.

The user should feel:

> “I logged into the system at the end of the day, saw which locations were blocked, resolved the few transactions automation could not safely finish, and closed the location.”

The user should **not** feel:

> “I opened a demo and clicked through an explanation of idempotency, retries, concurrency, and reconciliation.”

The difficult engineering remains in the product, but it sits underneath ordinary accounting workflows as inspectable evidence.

## Core product rule

**If automation can safely resolve something, PostOnce should not ask the operator to look at it.**

## Information hierarchy

1. Business truth
2. Work requiring human action
3. Evidence explaining how the business truth was established
4. Raw integration details only on demand

Example:

**Primary UI**

- $1,125.00
- Daniel Harper
- RO-8004
- Posted
- Payout pending

**Expanded evidence**

- processor event
- correlation ID
- DMS operation key
- first response timeout
- recovery lookup
- existing posting found
- one financial mutation

---

# 2. Current repository: preserve vs replace

The current repository already contains valuable engineering machinery:

- React + TypeScript + Vite web client
- NestJS REST API
- PostgreSQL migrations
- session-isolated synthetic runs
- processor inbox / duplicate protection
- payment allocations
- posting outbox
- DMS postings
- integration attempts
- append-only audit events
- settlement records
- optimistic exception versions
- deterministic failure fixtures
- browser/integration/concurrency tests

**Preserve all of that unless a schema extension is required.**

The current public app is still built around:

- `/demo`
- deterministic “chapters”
- `process-routine`
- `deliver-duplicate`
- `simulate-lost-response`
- `open-ambiguous-exception`
- `simulate-resolution-race`
- `reconcile-settlement`

Those concepts should stop being the primary product experience.

The current database also already protects:

- unique processor events
- unique payment allocation operation keys
- stable outbound posting operation keys
- append-only integration attempts
- append-only audit events
- integer-cent money
- settlement arithmetic
- optimistic exception versions

These should survive.

---

# 3. Product shell and routes

## Primary application routes

```text
/app/close
/app/exceptions
/app/exceptions/:exceptionId
/app/payments
/app/payments/:paymentId
/app/deposits
/app/deposits/:depositId
/app/activity
/app/integrations
```

`/demo` may temporarily redirect to `/app/close` for compatibility.

Keep `/` as the marketing landing page.

Keep `/case-study` / `/architecture` outside the operator product if they exist.

## Primary navigation

```text
POSTONCE

Close
Exceptions      3
Payments
Deposits
Activity

────────────

Integrations
```

Do not put these in the primary navigation:

- Failure Lab
- Engineering Evidence
- Architecture
- Guided Demo
- Chapters
- Simulate Timeout
- Simulate Duplicate
- Simulate Race

Those belong in tests, case-study material, or hidden reviewer evidence—not everyday operations.

---

# 4. Fictional customer environment

## Organization

**Northline Motor Group**

Primary user:

**Maya Chen**  
Group Controller

Secondary seeded identities:

- Jordan Lee — Accounting Clerk
- Avery Patel — Office Manager
- Sam Rivera — Integration Admin

No real customer or dealership information.

## Locations

### Northline Toyota

```text
Code: NLT
City: Calgary
Friday payments: 19
Processed total: $13,842.17
Operational posting exceptions: 0
Operational close: READY
Settlement: PAYOUT PENDING
```

Department distribution:

```text
Service  11
Parts     5
Sales     3
```

### Northline Ford

```text
Code: NLF
City: Calgary
Friday payments: 27
Processed total: $21,604.80
Auto-finished: 24
Open exceptions: 3
Operational close: BLOCKED
Settlement: PAYOUT PENDING
```

Department distribution:

```text
Service  16
Parts     6
Sales     5
```

### Northline Subaru

```text
Code: NLS
City: Calgary
Friday payments: 16
Processed total: $11,390.42
Operational posting exceptions: 0
Operational close: READY
Settlement: PAYOUT PENDING

Prior-day payout:
Expected $18,742.61
Observed $18,717.61
Variance $25.00
Status VARIANCE
```

Department distribution:

```text
Service   9
Parts     4
Sales     3
```

All figures are deterministic synthetic fixtures.

---

# 5. Important domain correction: two separate timelines

Do **not** model “today’s operational close” and “bank settlement” as one synchronous event.

They are separate concerns.

## Operational posting

Question:

> Have today’s payments been safely accounted for and posted to the DMS, with no unresolved blocking work?

A healthy Friday-evening transaction may be:

```text
Payment       CAPTURED
DMS           POSTED
Settlement    PAYOUT PENDING
```

This is normal.

## Settlement reconciliation

Question:

> When the processor payout arrives later, does the observed bank deposit equal the expected payout?

This may occur on a later day.

Therefore:

**today’s payout still being pending MUST NOT block the operational day close.**

A prior payout variance can remain a separate work item.

---

# 6. State model

Use distinct status dimensions.

## Payment status

```text
CAPTURED
PENDING
FAILED
VOIDED
REFUNDED
```

Current `payments.status` may remain internally if useful, but the product read model should expose a clearer payment-state dimension.

## DMS posting status

```text
UNMATCHED
MATCHED
POSTING
POSTED
VERIFIED
NEEDS_REVIEW
```

## Settlement status

```text
NOT_YET_BATCHED
PAYOUT_PENDING
DEPOSIT_EXPECTED
RECONCILED
VARIANCE
```

## Operational location close status

```text
PROCESSING
BLOCKED
READY
CLOSED
```

Recommended readiness rule:

A location is `READY` when:

- all in-scope Friday payment events are accounted for,
- every required allocation is complete,
- every required DMS posting is verified or otherwise in a valid terminal state,
- there are zero unresolved **blocking operational exceptions**.

Settlement `PAYOUT_PENDING` does not block `READY`.

---

# 7. Exception taxonomy

Extend first-class human exceptions to:

```text
UNMATCHED_PAYMENT
AMBIGUOUS_MATCH
SPLIT_ALLOCATION
UNMATCHED_REFUND
POSTING_STATUS_UNKNOWN
SETTLEMENT_VARIANCE
```

Do not make these human exceptions when they self-heal:

```text
DUPLICATE_WEBHOOK
RECOVERED_DMS_TIMEOUT
STALE_VERSION_CONFLICT
NORMAL_PAYOUT_PENDING
EXPECTED_ACH_PROCESSING
OUTBOX_RETRY
```

Those are system/evidence concerns.

## Severity

```text
BLOCKING
REVIEW
```

For MVP:

- unmatched payment: BLOCKING
- ambiguous match: BLOCKING
- split allocation: BLOCKING
- unmatched refund: BLOCKING
- posting status unknown: BLOCKING
- settlement variance: REVIEW or BLOCKING for settlement reconciliation, but **not** for same-day operational close unless it belongs to that operational day and policy explicitly requires it

---

# 8. Exact seeded Ford exception fixtures

## EX-104 — Ambiguous repair-order match

```text
Exception ID: EX-104
Location: Northline Ford
Department: Service
Payment ID: PAY-104
Amount: $1,125.00
Method: Visa •••• 4242
Time: 4:37 PM
Customer: Daniel Harper
Terminal: Terminal 04
Processor reference: txn_84K1F
Status: OPEN
Severity: BLOCKING
```

Reason:

> The payment has two plausible service repair orders and deterministic matching cannot safely choose one.

### Candidate A

```text
RO: RO-8004
Customer: Daniel Harper
Vehicle: 2022 Ford F-150
Service advisor: J. Patel
Customer-pay balance: $1,125.00
Status: CLOSED
Closed: 4:31 PM
```

Evidence:

- exact amount
- same customer
- same location
- same department
- RO closed six minutes before payment

Recommendation:

`STRONG MATCH`

### Candidate B

```text
RO: RO-8031
Customer: Daniel Harper
Vehicle: 2020 Ford Escape
Service advisor: A. Ross
Customer-pay balance: $1,100.00
Status: OPEN
```

Evidence:

- same customer
- same location
- same department
- amount differs by $25
- RO still open

Recommendation:

`POSSIBLE MATCH`

### Actions

```text
Apply to RO-8004
Apply to RO-8031
Split / allocate differently
Search another record
Leave unresolved
```

Default happy path for the seeded workspace:

**Maya chooses `Apply to RO-8004`.**

Result:

- allocation created
- DMS posting queued
- posting completes
- exception becomes RESOLVED
- audit event records Maya’s decision
- Ford open exception count decreases from 3 → 2

AI may show a one-line advisory:

> Suggested: RO-8004 — exact amount, customer, location and timing align.

AI MUST NOT mutate state.

---

## EX-105 — Refund needs original transaction

```text
Exception ID: EX-105
Location: Northline Ford
Department: Parts
Payment ID: PAY-105
Amount: -$219.00
Method: Visa •••• 1148
Time: 4:18 PM
Status: OPEN
Severity: BLOCKING
```

Prompt:

> This refund has no verified link to its original payment.

Candidate originals:

### Candidate A

```text
Date: Apr 03
Amount: $219.00
Department: Parts
Ticket: P-18401
Customer: Morgan Brooks
```

### Candidate B

```text
Date: Apr 02
Amount: $478.50
Department: Parts
Ticket: P-18372
Customer: Morgan Brooks
```

Actions:

```text
Link to P-18401
Link to P-18372
Search another payment
Leave unresolved
```

Happy path:

**Link to P-18401.**

Result:

- refund-original relationship recorded
- DMS/accounting correction posted if model requires it
- exception resolved
- Ford count 2 → 1
- append-only activity entry created

---

## EX-106 — Split tender needs allocation

```text
Exception ID: EX-106
Location: Northline Ford
Department: Service
Payment ID: PAY-106
Amount: $2,450.00
Method: Mastercard •••• 6621
Time: 4:09 PM
Status: OPEN
Severity: BLOCKING
Customer: Riley Morgan
```

Candidate DMS record:

```text
RO: RO-8018
Customer-pay total: $4,000.00
Existing payment:
  Visa •••• 9012
  $1,550.00
  received 4:01 PM

New unmatched payment:
  Mastercard •••• 6621
  $2,450.00
  received 4:09 PM

$1,550 + $2,450 = $4,000
```

Prompt:

> Likely second half of a split-tender payment.

Actions:

```text
Attach $2,450 to RO-8018
Allocate differently
Search another record
Leave unresolved
```

Happy path:

**Attach to RO-8018.**

Result:

- second allocation created
- invoice/RO customer-pay balance reaches zero
- DMS posting verified
- exception resolved
- Ford count 1 → 0
- location state recalculates to READY

---

# 9. Hidden engineering fixtures

These should still execute the important correctness behavior, but should not become product “chapters.”

## Hidden duplicate delivery

Seed one routine Toyota payment:

```text
Payment: PAY-1006
Amount: $459.00
Department: Service
RO: RO-7920
```

Processor delivers the same event twice.

Operator sees:

```text
Payment: CAPTURED
DMS: POSTED
```

Evidence shows:

```text
Processor deliveries: 2
Accepted domain mutations: 1
Duplicate delivery: absorbed
```

No exception.

## Hidden lost DMS response

Seed one routine Toyota payment:

```text
Payment: PAY-1017
Amount: $1,245.00
Department: Service
RO: RO-7921
```

DMS behavior:

1. first POST commits successfully
2. HTTP response is intentionally lost
3. retry/recovery uses the same destination operation key
4. existing DMS posting is located
5. no second posting is created

Operator sees:

```text
DMS
POSTED · VERIFIED
```

Evidence shows:

```text
Attempt 1
POST /cash-receipts
DMS write COMMITTED
response TIMED OUT

Recovery
lookup same operation key
200 EXISTING POST FOUND

Financial mutations: 1
```

No exception because recovery succeeded.

## Concurrency

Do not expose “simulate race.”

Keep optimistic concurrency real.

If two tabs/users submit EX-104 at the same version:

- first mutation succeeds
- second receives `VERSION_CONFLICT`
- second UI displays:

> This item was already resolved by Maya Chen. The latest record has been loaded.

The rejected request remains in technical/audit evidence.

Keep automated concurrency tests.

---

# 10. Screen specification

# A. `/app/close`

This is the product home screen.

## Page header

```text
Friday close
Northline Motor Group
Sep 4, 2026
```

Top summary should emphasize work, not vanity metrics.

```text
2 locations ready
1 location blocked
3 open operational exceptions
1 prior payout variance
```

Avoid revenue charts and SLA cards.

## Location table / operational board

Required columns:

```text
Location
Payments
DMS posting
Open work
Settlement
Close
```

Seeded rows:

### Northline Toyota

```text
Payments: 19
DMS: 19 / 19
Open work: None
Settlement: Payout pending
Close: READY
```

### Northline Ford

Initial:

```text
Payments: 27
DMS: 24 / 27
Open work: 3 exceptions
Settlement: Payout pending
Close: BLOCKED
```

After exception resolution:

```text
Payments: 27
DMS: 27 / 27
Open work: None
Settlement: Payout pending
Close: READY
```

### Northline Subaru

```text
Payments: 16
DMS: 16 / 16
Open work: None
Settlement: Payout pending
Close: READY
```

Separate lower section:

```text
Prior settlements requiring attention

Northline Subaru
Thursday payout
$25.00 variance
Review →
```

Clicking `3 exceptions` opens filtered `/app/exceptions?location=NLF`.

Clicking a location opens a location close detail view or expands row detail.

## Close location action

Only enabled when operational state is `READY`.

Confirmation:

```text
Close Northline Ford

27 processor payments accounted for
27 DMS postings verified
0 unresolved operational exceptions
Today's processor payout: pending settlement — normal

[Cancel] [Close location]
```

After action:

```text
Northline Ford
CLOSED
Closed by Maya Chen
5:02 PM
```

Audit event required.

---

# B. `/app/exceptions`

Primary work queue.

## Header

```text
Exceptions
3 open
```

Optional involved value:

`$3,794.00 involved`

Do not overemphasize the aggregate.

## Filters

```text
Location
Department
Type
Status
Newest / Oldest / Amount
```

Departments:

```text
Service
Parts
Sales
```

## Rows

Show:

```text
exception type
amount
customer
location
department
one-sentence reason
age
severity
```

Do not display raw correlation IDs in the queue.

Seeded order:

1. EX-104 Ambiguous match — $1,125
2. EX-105 Unmatched refund — -$219
3. EX-106 Split allocation — $2,450

Resolved items can be viewed under `Resolved`.

---

# C. `/app/exceptions/:exceptionId`

This is the most important working surface.

Layout should prioritize:

1. financial object
2. candidate business records
3. evidence for the human decision
4. action

Technical integration evidence remains collapsed.

## Required sections

```text
Payment summary
Why it needs review
Candidate records
Evidence for each candidate
Resolution actions
Activity
Technical evidence (collapsed)
```

When resolved:

- lock financial controls
- show who resolved
- show chosen action
- show resulting DMS/posting state
- keep original alternatives visible as historical context if useful

---

# D. `/app/payments`

Searchable transaction history.

## Search

Support:

```text
customer
RO number
parts ticket
deal number
processor reference
amount
card last four
operation key
correlation ID
```

Operation/correlation search may be hidden under advanced search but should work.

## Filters

```text
Location
Department
Payment state
DMS state
Settlement state
Method
Date
```

## Table fields

```text
Time
Customer
Amount
Method
Department
Location
DMS record
Posting
Settlement
```

Example:

```text
16:37
Daniel Harper
$1,125.00
Visa •••• 4242
Service
Northline Ford
RO-8004
POSTED
PAYOUT PENDING
```

Do not lead with event IDs.

---

# E. `/app/payments/:paymentId`

## Top

```text
$1,125.00
Daniel Harper

Visa •••• 4242
Northline Ford · Service
Sep 4 · 4:37 PM
```

## Three state blocks

```text
PAYMENT
Captured

DMS
RO-8004 · Posted

SETTLEMENT
Payout pending
```

## Human-readable timeline

```text
4:37:14  Payment received
4:37:14  Matched to RO-8004
4:37:15  Posted to dealership system
4:37:15  Posting verified
```

For a refund:

show original linked payment.

For split tender:

show all linked payments and allocations.

## Evidence accordion

Collapsed by default.

When expanded:

```text
Processor delivery evidence
Allocation decision
DMS integration attempts
Operation key
Correlation ID
Sanitized request / response
Audit events
Invariant result
```

This is where duplicate/lost-response engineering becomes visible.

---

# F. `/app/deposits`

This is a settlement workspace, separate from operational close.

## List fields

```text
Payout date
Location
Processor payout ID
Expected
Observed
Variance
Status
```

Examples:

```text
Sep 03
Northline Toyota
PAYOUT-9834
$14,884.92
$14,884.92
$0.00
RECONCILED
```

```text
Sep 03
Northline Subaru
PAYOUT-9842
$18,742.61
$18,717.61
$25.00
VARIANCE
```

Today's unsettled items can show:

```text
Sep 04
Northline Ford
Payout not yet generated
PAYOUT PENDING
```

Do not label this as an error.

---

# G. `/app/deposits/:depositId`

Show settlement equation.

For synthetic processor contract:

```text
Captured payments      $19,162.45
Refunds                   -$219.00
Processor fees            -$200.84
Adjustments                  $0.00
────────────────────────────────
Expected payout          $18,742.61

Observed bank deposit    $18,717.61
────────────────────────────────
Variance                     $25.00
```

Then show the supporting source records.

For the seeded $25 variance, provide a deterministic explanation fixture.

Recommended simple fixture:

```text
Processor settlement adjustment missing from expected model:
Network assessment adjustment: $25.00
```

The user can:

```text
Record supported adjustment
Mark unresolved
```

If adjustment is recorded, use an append-only adjustment/reconciliation record; do not silently overwrite prior amounts.

Result:

```text
Expected payout adjusted: $18,717.61
Observed: $18,717.61
Variance: $0.00
RECONCILED
```

Activity records the action.

---

# H. `/app/activity`

Human-readable audit stream.

Examples:

```text
5:02 PM
Maya Chen
Closed Northline Ford

4:58 PM
Maya Chen
Attached $2,450 payment to RO-8018

4:55 PM
Maya Chen
Linked -$219 refund to original Parts payment

4:52 PM
Maya Chen
Applied $1,125 payment to RO-8004

4:48 PM
System
Recovered an uncertain dealership-system response for PAY-1017

4:39 PM
System
Absorbed a duplicate processor delivery for PAY-1006
```

Filters:

```text
Actor
System / Human
Location
Entity type
Date
```

Every row can open the related object.

Raw technical audit details are secondary.

---

# I. `/app/integrations`

Secondary/admin screen.

Seed:

```text
LegacyDMS Simulator
CONNECTED
Last successful sync: 12 sec ago

Northstar Processor
CONNECTED
Last event: 4 sec ago

Prairie Bank Feed
CONNECTED
Last refresh: 2 min ago
```

Actions:

```text
View attempts
View mapping
Test connection
```

No giant observability dashboard.

## Matching policy

Display ordered matching policy:

```text
1. Exact RO / ticket / deal reference
   Same location + exact source reference

2. Exact invoice reference
   Same location + reference + amount

3. Customer + exact amount
   Same location + constrained time window

4. Candidate only
   Same customer + nearby amount
   HUMAN REVIEW REQUIRED
```

This can be read-only in MVP.

---

# 11. Roles and permissions

MVP may seed role data without implementing full authentication.

## Accounting Clerk

- assigned locations
- view payments
- resolve standard matches
- link refunds
- cannot record settlement adjustments
- cannot close a location

## Office Manager

- one location
- resolve matches/refunds
- limited adjustments
- can close own location

## Group Controller

- all locations
- all financial resolutions
- settlement adjustments
- close locations

## Integration Admin

- integration diagnostics
- attempt logs
- mapping
- no financial resolution rights

Default public/demo persona:

**Maya Chen — Group Controller**

---

# 12. Data-model changes

Do not rewrite the schema unnecessarily.

Create a new migration, e.g.:

```text
003_product_workspace.sql
```

Recommended extensions.

## `rooftops`

Current fields already include ID, code, name, city.

Optional add:

```text
timezone
status
```

## DMS records

Current `invoices` are repair-order-centric.

For MVP either:

### Option A — least migration risk

Keep `invoices` as the underlying table and add:

```text
department
record_type
record_number
vehicle_label
advisor_label
```

Where:

```text
record_type = REPAIR_ORDER | PARTS_TICKET | DEAL
department = SERVICE | PARTS | SALES
```

Keep `repair_order_number` temporarily for backward compatibility or migrate to `record_number`.

### Option B — cleaner but larger refactor

Rename/generalize `invoices` into `dms_records`.

Only choose Option B if repository changes remain manageable.

Prefer Option A for this pass.

## `payments`

Add read-model/business context fields as needed:

```text
department
method_type
card_last4
terminal_label
processor_transaction_id
payment_state
```

Do not store real PAN/CVV.

For refunds, either allow signed amounts in a separate business read model or preserve current positive `amount_cents + kind=REFUND` and render as negative in UI.

## `payment_exceptions`

Expand type constraint.

Current:

```text
AMBIGUOUS_ALLOCATION
VERSION_CONFLICT
```

New human-facing types:

```text
UNMATCHED_PAYMENT
AMBIGUOUS_MATCH
SPLIT_ALLOCATION
UNMATCHED_REFUND
POSTING_STATUS_UNKNOWN
SETTLEMENT_VARIANCE
```

`VERSION_CONFLICT` should become a system/audit outcome, not a persistent operator exception type, unless there is a strong internal reason to retain it.

Add optional:

```text
rooftop_id
department
assigned_to
resolved_by
resolved_at
```

if not already present in JSON resolution.

## Operational closes

Add a per-rooftop close table or read model.

Suggested:

```text
operational_closes
- session_id
- id
- rooftop_id
- business_date
- payment_count
- accounted_payment_count
- verified_posting_count
- blocking_exception_count
- status PROCESSING|BLOCKED|READY|CLOSED
- closed_by
- closed_at
```

Use DB constraints where appropriate.

## Settlements

Current `settlements` lack rooftop/business-date specificity.

Extend or add new payout model:

```text
processor_payouts
- session_id
- id
- rooftop_id
- payout_date
- external_payout_id
- currency
- captured_cents
- refund_cents
- fee_cents
- adjustment_cents
- expected_deposit_cents
- observed_bank_cents
- variance_cents
- status PAYOUT_PENDING|DEPOSIT_EXPECTED|RECONCILED|VARIANCE
```

Keep source records append-only.

## Refund linkage

Add a relation:

```text
refund_links
- session_id
- refund_payment_id
- original_payment_id
- created_by
- created_at
```

or represent this through allocation/association data if cleanly possible.

## Settlement adjustments

Use append-only records:

```text
settlement_adjustments
- session_id
- id
- payout_id
- amount_cents
- reason
- evidence
- actor
- created_at
```

Never silently change historical source evidence.

---

# 13. API changes

The current demo API is chapter/action-centric.

Do not immediately delete old endpoints if tests or landing links depend on them.

Add product-oriented APIs first.

## Workspace

```text
GET /api/workspace
```

Returns:

- user
- organization
- locations
- open exception count
- prior settlement work count

## Close

```text
GET  /api/close
GET  /api/close/:rooftopId
POST /api/close/:rooftopId/close
```

Close action must validate readiness server-side.

Return `409`/`422` if blocking work remains.

## Exceptions

```text
GET  /api/exceptions
GET  /api/exceptions/:id

POST /api/exceptions/:id/resolve-match
POST /api/exceptions/:id/link-refund
POST /api/exceptions/:id/resolve-split
```

All mutating exception actions require:

```text
expectedVersion
idempotencyKey
```

Preserve optimistic concurrency.

## Payments

```text
GET /api/payments
GET /api/payments/:id
```

Filters via query params.

Payment detail returns business-facing timeline plus optional evidence bundle.

## Deposits

```text
GET /api/deposits
GET /api/deposits/:id

POST /api/deposits/:id/adjustments
```

Adjustment endpoint must be append-only and idempotent.

## Activity

```text
GET /api/activity
```

Human-readable projection over `audit_events`.

## Integrations

```text
GET /api/integrations
GET /api/integrations/:system/attempts
```

## Evidence

Do not make evidence a primary route requirement, but support:

```text
GET /api/payments/:id/evidence
GET /api/exceptions/:id/evidence
GET /api/deposits/:id/evidence
```

These may project existing `integration_attempts` and `audit_events`.

---

# 14. Seed/reset behavior

The public environment should still be deterministic and isolated.

On first app visit:

- create isolated session automatically if none exists
- seed Northline Motor Group workspace
- land directly at `/app/close`

Do not show a modal:

> Start demo?

Do not force a tutorial.

## Reset

Keep reset capability but hide it under the user menu:

```text
Maya Chen
Group Controller

Reset synthetic workspace
About this environment
```

Reset returns all fixtures to their initial state.

It must remain isolated by visitor session.

---

# 15. Replace chapter actions with product state

Current chapter actions may remain as internal fixture/test helpers temporarily.

But production UI must not call:

```text
process-routine
deliver-duplicate
simulate-lost-response
open-ambiguous-exception
simulate-resolution-race
reconcile-settlement
run-all
```

from visible buttons.

Instead:

**session creation seeds the ordinary system state already in motion.**

For example:

- routine payments already processed
- duplicate already absorbed
- recovered lost-response already completed
- Ford exceptions already open
- prior Subaru settlement variance already present

The product opens **after automation has done its job**.

This is critical.

---

# 16. Interaction flow that must work before visual redesign

Build this with basic but usable UI first.

## Flow 1 — open blocked location

1. Open `/app/close`.
2. See:
   - Toyota READY
   - Ford BLOCKED / 3 exceptions
   - Subaru READY
3. Click Ford `3 exceptions`.
4. Land on exceptions filtered to Ford.

## Flow 2 — resolve EX-104

1. Open ambiguous $1,125 payment.
2. Compare RO-8004 and RO-8031.
3. Choose RO-8004.
4. Server validates version.
5. Allocation posts.
6. Exception resolves.
7. Return/list now shows 2 remaining.

## Flow 3 — resolve EX-105

1. Open -$219 refund.
2. Link to $219 original Parts payment.
3. Exception resolves.
4. 1 remaining.

## Flow 4 — resolve EX-106

1. Open $2,450 split payment.
2. See existing $1,550 payment and $4,000 RO total.
3. Attach second payment to RO-8018.
4. Exception resolves.
5. Ford automatically recalculates to READY.

## Flow 5 — close Ford

1. Return to Close.
2. Ford now shows:
   - 27/27 DMS
   - zero open work
   - payout pending
   - READY
3. Click Close.
4. Confirmation explicitly says payout pending is normal.
5. Close location.
6. Ford becomes CLOSED.
7. Activity records Maya.

## Flow 6 — review prior payout variance

1. Open Deposits or click Subaru prior payout alert.
2. View expected vs observed.
3. See $25 variance.
4. Record supported $25 adjustment.
5. Reconciliation becomes zero variance.
6. Activity/evidence remain append-only.

This is the minimum vertical slice.

---

# 17. Technical evidence behavior

Evidence should be contextual.

Do not permanently consume a large percentage of every screen.

Use:

```text
Evidence
```

accordion/drawer/tab.

## Lost-response payment evidence

Show:

```text
DMS write
COMMITTED

Response
TIMED OUT

Recovery lookup
same operation key

Result
EXISTING POST FOUND

Financial mutations
1
```

Then raw IDs underneath.

## Duplicate delivery evidence

Show:

```text
Processor deliveries
2

Accepted mutations
1

Result
Duplicate absorbed
```

## Concurrency evidence

If conflict occurs:

```text
Expected version
4

Current version
5

Result
Write rejected

Winning actor
Maya Chen
```

Operator copy stays human:

> This item was already resolved by Maya Chen.

---

# 18. What to remove from product UI

Delete/de-emphasize:

- chapter navigation
- failure demo controls
- run-all button
- technical “scenario” cards
- architecture diagrams in operator app
- benchmark cards in operator app
- invariant counters on home page
- correlation IDs as primary labels
- raw API attempts as primary workflow
- generic AI assistant
- generic analytics dashboard
- fake operational KPIs

Keep these in:

- tests
- case study
- architecture docs
- evidence drawers
- integration diagnostics

---

# 19. Build behavior before visual polish

Prove the complete workflow with a clean, usable shell before spending time on micro styling. Then complete the binding visual system and screenshot QA in this same delivery. The product is not done until both behavior and visual hierarchy pass.

---

# 20. Test requirements

Preserve existing correctness tests.

Add product-level tests.

## Seed state

Assert:

- 3 rooftops exist
- Toyota 19 / ready
- Ford 27 / 3 blocking exceptions / blocked
- Subaru 16 / ready
- prior Subaru payout has $25 variance
- duplicate fixture has one domain mutation
- lost-response fixture has one DMS posting

## EX-104

Assert:

- candidate data is deterministic
- resolving RO-8004 creates one allocation
- repeated identical idempotency request does not duplicate
- stale version returns `VERSION_CONFLICT`
- Ford open count becomes 2

## EX-105

Assert:

- refund link created exactly once
- invalid original payment rejected
- Ford count becomes 1

## EX-106

Assert:

- $1,550 + $2,450 = $4,000
- allocation cannot exceed remainder
- Ford count becomes 0
- Ford becomes READY

## Close

Assert:

- Ford cannot close before three exceptions are resolved
- settlement `PAYOUT_PENDING` does not block operational close
- Ford can close after operational readiness
- second close request is idempotent or safely rejected
- close audit event appended

## Deposit variance

Assert:

- source settlement evidence remains immutable
- adjustment appended rather than overwriting evidence
- resulting variance becomes zero
- status becomes RECONCILED
- audit event appended

## Hidden duplicate

Assert:

- delivery_count = 2
- one payment mutation
- no operator exception

## Hidden lost response

Assert:

- one DMS posting
- multiple integration attempts
- stable operation key
- operator-facing state VERIFIED
- no operator exception

## Concurrency

Assert true concurrent resolution behavior remains covered.

## Browser E2E

Required journey:

```text
open Close
→ Ford
→ resolve EX-104
→ resolve EX-105
→ resolve EX-106
→ Ford READY
→ close Ford
→ open Subaru payout
→ record adjustment
→ RECONCILED
```

Run at desktop and mobile widths.

---

# 21. Documentation updates

Update repository docs so the old 90-second chapter framing no longer claims to be the product.

Revise:

```text
README.md
docs/PRODUCT_SPEC.md
docs/API_CONTRACT.md
docs/GUIDED_REVIEW* if present
docs/DOMAIN_GLOSSARY.md
```

New README language should emphasize:

- fictional dealership operations workspace
- routine automation is invisible
- human operators work exceptions and closes
- technical evidence remains inspectable
- all data synthetic
- no real processor/DMS/bank integrations

The case study can still explain:

- duplicate delivery
- lost response
- concurrency
- settlement arithmetic

But describe these as **engineering behavior underneath the product**.

---

# 22. Migration strategy

Do not perform a huge-bang rewrite.

Recommended order:

## Phase 1 — product read model

- extend fixture types/contracts
- seed three rooftops
- create product-oriented API projections
- keep old schema and demo endpoints running

## Phase 2 — workflow mutations

- expand exception types
- implement refund linkage
- implement split allocation
- implement per-rooftop operational close
- implement payout adjustment

## Phase 3 — product routes

- add `/app/*`
- make `/demo` redirect to `/app/close`
- stop exposing chapter controls

## Phase 4 — tests

- new API tests
- new browser vertical-slice journey
- preserve old correctness/invariant tests

## Phase 5 — cleanup

Only after product flow passes:

- remove obsolete chapter UI
- decide whether old action endpoints remain as test helpers or are deleted
- update docs

---

# 23. Definition of done

The pass is complete only when a cold visitor can do this without being taught:

1. Open PostOnce.
2. Understand that Ford is blocked.
3. Open the three work items.
4. Resolve them using business information.
5. Watch Ford become ready.
6. Close Ford.
7. Notice a separate prior payout variance.
8. Reconcile it.
9. Open a payment and optionally inspect technical evidence.

And importantly:

A technical reviewer can still discover that:

- duplicate delivery mutated state once,
- lost DMS response recovered with the same operation key,
- stale versions are rejected,
- financial history is append-only,
- settlement arithmetic is proven from independent records.

But none of those mechanisms should feel like the main operator workflow.

---

# 24. Agent instruction — copy this as the implementation command

> Rework PostOnce from a guided engineering demo into the product-first dealership payment-operations workspace defined in `POSTONCE_PRODUCT_BLUEPRINT.md`.
>
> Inspect the repository before editing. Preserve the existing correctness engine, PostgreSQL constraints, inbox/outbox behavior, idempotency, optimistic concurrency, integration attempts, audit evidence, session isolation, tests, and simulators wherever possible.
>
> The core change is the product model and operator experience:
>
> `Close → Exceptions → Payments → Deposits → Activity → Integrations`
>
> Build the deterministic Northline Motor Group workspace with three locations and the exact seeded exception workflows from the blueprint.
>
> The application must open directly into a realistic operating state. Do not expose a “Start demo,” chapter progression, Failure Lab, `simulate-*` controls, or run-all button in the operator interface.
>
> Routine payments must already be automated. The three Ford exceptions must be actual human work items. Resolving all three must make Ford READY, after which Maya can close the location even though today’s processor payout is still pending. The Subaru prior-day $25 payout variance must be a separate settlement workflow.
>
> Preserve duplicate-delivery, lost-response, and concurrency behavior underneath the product. Successful self-recovery must not become operator exceptions. Expose technical details only through contextual Evidence views.
>
> Build a clean, usable, truthful functional UI first, then complete the binding visual redesign and screenshot QA in the same delivery. No fake metrics, no invented production data, no fake integrations, no generic analytics charts.
>
> Add/update migrations, shared contracts, API routes, deterministic seed data, domain tests, API tests, and browser E2E coverage as required.
>
> Do not call the work complete until the complete vertical slice works:
>
> `Close → Ford → EX-104 → EX-105 → EX-106 → Ford READY → Close Ford → Subaru payout → $25 adjustment → RECONCILED`.
>
> After implementation, run the repository’s full verification suite and fix failures rather than weakening tests or invariants.

---

# 25. Final product test

Use this question throughout implementation:

> **Would a dealership controller understand what work needs doing without knowing this is an engineering portfolio demo?**

If no, simplify the product surface.

Then ask:

> **Could a CTO inspect one of those ordinary business objects and discover serious engineering underneath it?**

If yes, PostOnce is doing the right thing.
