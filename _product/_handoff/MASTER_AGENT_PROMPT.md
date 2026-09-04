# MASTER IMPLEMENTATION PROMPT — POSTONCE PRODUCT REBUILD

Work in the existing PostOnce repository.

Before changing code, read these files in full:

1. `CANONICAL_DECISIONS.md`
2. `POSTONCE_PRODUCT_BLUEPRINT.md`
3. `DESIGN_SYSTEM.md`
4. `IMPLEMENTATION_RULES.md`
5. all five PNGs in `/design`

Then inspect the repository architecture, current migrations, API contracts, demo/session model, worker/outbox logic, integration simulators, and current automated tests.

## Authority

- CANONICAL DECISIONS resolve conflicts and are highest authority.
- The PRODUCT BLUEPRINT is otherwise binding for product behavior, synthetic data, terminology, routes, state transitions, and acceptance criteria.
- The DESIGN SYSTEM is binding for visual language.
- The five screen references are binding for screen composition and visual hierarchy.
- If text/data visible in a generated design reference conflicts with the blueprint, THE BLUEPRINT WINS.

Do not copy generated screenshot mistakes into the product.

## Goal

Turn PostOnce from a guided engineering presentation into a believable, working dealership payment-operations product.

A cold visitor should be able to:

1. land on Close
2. see which rooftop is blocked
3. resolve actual business exceptions
4. watch Ford become READY
5. close Ford
6. separately review a prior payout variance
7. reconcile it
8. open a normal payment and optionally inspect the hidden engineering evidence underneath

The experience must feel like software a dealership controller could use, not a portfolio demo.

## Preserve the engineering

Do not throw away the hard backend work.

Preserve and reuse where possible:
- unique processor event handling
- idempotent domain mutation
- stable external operation identity
- inbox/outbox behavior
- Postgres constraints
- integer-cent money
- optimistic concurrency
- integration attempts
- append-only audit history
- DMS simulator
- settlement/bank simulator
- isolated synthetic sessions
- existing correctness and concurrency tests

The product should hide these mechanisms during normal operation, not delete them.

## Replace the product IA

Primary app navigation must become:

- Close
- Exceptions
- Payments
- Deposits
- Activity
- Integrations

Remove old demo-first UI concepts from the operator experience:
- chapter navigation
- run all
- Failure Lab
- simulate duplicate
- simulate lost response
- simulate race
- engineering-evidence dashboard

Routine automation is already complete when the synthetic workspace opens.

## Build the exact Northline environment

Implement the deterministic organization, rooftops, payment counts, exceptions, settlement variance, candidate ROs, user roles, and workflow states defined in the product blueprint.

Do not invent alternate fixtures because they are easier to display.

Do not use real OEM logos.

## Required working journey

Implement and test this exact vertical slice:

1. `/app/close`
2. Ford is BLOCKED with 3 exceptions
3. open Ford exceptions
4. resolve EX-104 by applying $1,125 to RO-8004
5. resolve EX-105 by linking -$219 refund to P-18401
6. resolve EX-106 by attaching $2,450 to RO-8018
7. Ford automatically becomes READY
8. close Northline Ford
9. open Northline Subaru's prior-day $25 payout variance
10. record the supported adjustment
11. settlement becomes RECONCILED with zero variance

The journey must mutate actual persisted synthetic state, not just swap front-end screens.

## Hidden correctness scenarios

Keep these real underneath the product:

### Duplicate delivery
Routine payment receives two processor deliveries, one accepted mutation, no operator exception.

### Lost DMS response
DMS write commits, response disappears, PostOnce looks up the same operation identity, existing post is found, financial mutation count remains one.

Operator sees only:
`POSTED · VERIFIED`

The detail page's Evidence Seam reveals what happened.

### Concurrency
Two users/tabs resolving the same exception:
- first wins
- second receives version conflict
- UI says the item was already resolved and reloads latest state
- losing attempt remains queryable in evidence

Do not add user-facing buttons to simulate these failures.

## Visual implementation

Do not use a generic component library aesthetic by default.

Implement the five signature patterns exactly as described:

### Close Rails
Location rows are the main object. No KPI card row.

### Work Slips
Exception queue items are ledger-like work slips, not cards.

### Decision Bench
Source payment, evidence bridge, and selected candidate form one comparison work surface.

### Evidence Seam
Technical evidence opens inline in the object's history, not as permanent visual clutter.

### Settlement Ledger
Expected, observed, and variance values align mathematically.

Use:
- warm ivory canvas
- quiet pale sidebar
- navy ink
- cobalt selection/actions
- green only for proven terminal state
- amber for review
- red for true discrepancy/rejection
- thin rules
- minimal shadows
- restrained corner radii

Do not add:
- KPI cards
- charts unless the product requirement actually needs them (it currently does not)
- gradients
- glass
- 3D artwork inside the app
- fake metrics
- decorative sidebars
- giant marketing serif headlines
- AI chatbot

## Screen references

### `/design/01_CLOSE_reference.png`
Use for layout and Close Rails.
Use blueprint counts and no OEM logos.

### `/design/02_EXCEPTIONS_reference.png`
Use for Work Slips.
Use the exact seeded exceptions/timestamps from blueprint.

### `/design/03_EX104_DECISION_BENCH_reference.png`
Use for EX-104 geometry.
Do not add the unrelated lost-response story here.
Blueprint candidate names/advisors/times override generated-image text.

### `/design/04_PAYMENT_EVIDENCE_reference.png`
Use for routine payment detail and Evidence Seam.
Evidence must show hidden lost-response recovery while top business state remains POSTED · VERIFIED.

### `/design/05_DEPOSIT_VARIANCE_reference.png`
Use for settlement-ledger composition.
Only blueprint payout values are authoritative.

## Build order

Work in this order internally, but ship the integrated product and design together:

1. inspect repository and map existing domain models
2. migrations/contracts for new product read model
3. deterministic Northline seed
4. product APIs
5. Close
6. Exceptions queue
7. EX-104, EX-105, EX-106 mutations
8. Payments + payment detail/evidence
9. Deposits + adjustment workflow
10. Activity
11. Integrations
12. redirect/remove old demo-first UI
13. E2E journey
14. screenshot-based visual QA
15. documentation updates

Do not spend time polishing an old demo route that will be removed.

## Visual QA is required

At minimum capture these five product states at 1536×1024 and compare against the supplied references:

- Close initial state
- Northline Ford exceptions queue
- EX-104 decision screen
- routine payment with Evidence expanded
- Subaru $25 deposit variance

Correct layout and visual hierarchy before declaring completion.

## Truthfulness

This is an independent synthetic engineering case study.

Never add fake:
- client logos
- certifications
- processors/banks as partners
- production SLAs
- revenue
- real transaction volume claims
- customer testimonials

Synthetic organization names and fixture data are okay as defined in the blueprint.

## Done means

The project is not done because the screens look correct.

It is done when:
- the full product journey works against persisted synthetic state
- server-side invariants are preserved
- hidden failures self-heal correctly
- evidence proves what happened
- the UI visually matches the supplied references
- automated tests pass
- no old demo/presentation concepts remain in the primary operator experience

Do not weaken tests or invariants to make the new UI pass.
