# PostOnce App Design System

## Purpose
This document defines the visual language for the redesigned PostOnce operator product. The five screen references in `/design` are the binding visual references. The product blueprint is the binding source for behavior, data, routes, and state transitions.

If screenshot text conflicts with `POSTONCE_PRODUCT_BLUEPRINT.md`, the blueprint wins.

## Design thesis
PostOnce should feel like a modern accounting workbench built over a deterministic financial control system.

It must not look like:
- a generic SaaS dashboard
- a demo walkthrough
- a card grid
- a cyberpunk control room
- a Stripe/Linear clone
- a Behance concept with gratuitous decoration

The personality comes from interaction geometry and information hierarchy, not gradients or ornament.

## Core visual patterns

### 1. Close Rails
Used on `/app/close`.

A location is expressed as a horizontal operational rail:

`Payments → DMS posting → Open work → Settlement → Close`

Rules:
- one location per horizontal rail
- use thin connecting lines and sparse nodes
- status is the rail endpoint, not a detached large badge
- blocked state interrupts the rail at the unresolved work point
- payout pending is neutral and can coexist with READY
- no KPI cards above the rails

### 2. Work Slips
Used on `/app/exceptions`.

Each exception is a structured work item, not a rounded card.

Anatomy:
- exception ID + department
- large amount + customer
- one concise reason
- useful business context
- age/time
- quiet `Review →` affordance

Rules:
- full slip is clickable
- use a thin amber left edge for unresolved human-review work
- do not repeat obvious descriptions
- no giant repeated blue buttons

### 3. Decision Bench
Used on ambiguous matching and other comparison decisions.

Three spatial zones:
- source financial object
- evidence bridge / comparison geometry
- selected business record

Rules:
- candidates align against the same evidence rows
- amount/customer/location/department/timing line up visually
- use subtle column wash for the strongest candidate
- evidence proves the decision; avoid arbitrary confidence percentages
- only one primary financial action at bottom

### 4. Evidence Seam
Used on payment detail, exception detail, and settlement detail.

Technical evidence is inserted into the history of the business object when requested.

Rules:
- business truth first
- technical proof collapsed by default
- expand evidence inline rather than forcing a permanent side panel
- use raw IDs only inside evidence
- show retries, operation keys, response states, and mutation counts compactly

### 5. Settlement Ledger
Used on `/app/deposits` and deposit detail.

Expected and observed amounts align mathematically.

Rules:
- no charts required
- source components should sum visibly to expected payout
- observed deposit sits directly beneath expected payout
- variance is a distinct line item
- supported adjustments append to history; they never rewrite source evidence

---

# Color tokens

```css
--canvas: #fbfaf6;
--surface: #fffefa;
--surface-soft: #f7f5ef;
--ink: #0c2344;
--muted: #6f7d91;
--rule: #dfe3e7;
--cobalt: #1260e8;
--cobalt-soft: #edf4ff;
--verified: #16815f;
--verified-soft: #e8f5ef;
--review: #d99714;
--review-soft: #fff4db;
--danger: #d84a3a;
--danger-soft: #fff0ed;
```

Usage:
- Cobalt = selected/current/primary action
- Green = proven/terminal verified state only
- Amber = human review / uncertainty
- Red = actual failure, rejection, or discrepancy
- Normal success rows should not be covered in green

---

# Typography

## App UI
Use one restrained modern sans throughout normal workflow UI.
Recommended: Geist Sans or the closest existing project font.

Hierarchy:
- page title: 32–38px / 700
- key financial amount: 38–46px / 700
- section heading: 18–22px / 700
- row primary: 15–17px / 600–700
- body: 14–16px / 400–500
- metadata: 12–14px / 400–500
- tiny uppercase section labels: 11–12px, only where useful

## Monospace
Use mono only for:
- processor references
- operation keys
- correlation IDs
- raw technical requests/responses

Do not use mono as a general visual theme.

## Serif
The marketing site may use serif. The operator app should be overwhelmingly sans. Do not copy landing-page editorial typography into daily workflows.

---

# Layout

## Desktop target
Primary reference viewport: 1536 × 1024.

Suggested shell:
- left nav: ~205–220px
- top utility bar: ~64–68px
- content gutters: 28–36px
- primary content max width should not artificially squeeze work surfaces

## Sidebar
- narrow and quiet
- pale neutral background
- active item: cobalt indicator + very subtle blue wash
- icons simple and consistent
- bottom user identity stays secondary
- no black/dark sidebar

## Search
- present but quiet
- do not let search dominate page hierarchy
- width around 400–520px desktop, depending on available space

## Rules and borders
Prefer:
- thin horizontal/vertical accounting rules
- whitespace
- alignment

Avoid:
- stacking every section in a rounded container
- thick borders
- heavy shadows

## Corners
- normal controls: 6–9px
- panels: 8–12px maximum when a panel is actually needed
- do not use 16–24px rounded cards everywhere

## Shadows
Almost none.
Use only for deliberately elevated evidence/temporary layers and keep them soft.

---

# Interaction language

## Primary actions
Financial mutations must say exactly what will happen.

Good:
- `Apply $1,125.00 to RO-8004`
- `Link refund to P-18401`
- `Attach $2,450.00 to RO-8018`
- `Close Northline Ford`
- `Record supported adjustment`

Bad:
- `Approve`
- `Submit`
- `Continue`

## Secondary actions
Keep visually restrained:
- Leave unresolved
- Search another record
- Mark for follow up
- View complete repair order

## Status labels
Use plain business language:
- READY
- BLOCKED
- CLOSED
- POSTED · VERIFIED
- PAYOUT PENDING
- VARIANCE

Avoid infrastructure jargon in primary status labels.

---

# Screen-specific notes

## `01_CLOSE_reference.png`
Binding pattern: Close Rails.

Important:
- use blueprint counts, not any generated numbers in a reference image
- do not use real OEM logos; use initials/simple fictional location marks
- `Payout pending` is neutral
- Ford row gets only a subtle attention treatment
- prior-day Subaru $25 variance remains separate from today's close

## `02_EXCEPTIONS_reference.png`
Binding pattern: Work Slips.

Use blueprint exact fixtures:
- EX-104 / $1,125 / Daniel Harper / Service
- EX-105 / -$219 / Morgan Brooks / Parts
- EX-106 / $2,450 / Riley Morgan / Service

At 4:55 PM seeded times:
- EX-106: 46 min ago / 4:09 PM
- EX-105: 37 min ago / 4:18 PM
- EX-104: 18 min ago / 4:37 PM

If sorted oldest, order is EX-106, EX-105, EX-104.

Default sort is Newest, so the initial queue is EX-104, EX-105, EX-106. The sort control must say Newest when displaying that order.

## `03_EX104_DECISION_BENCH_reference.png`
Binding pattern: Decision Bench.

Blueprint data overrides screenshot details where they conflict.
Candidate A:
- RO-8004
- Daniel Harper
- 2022 Ford F-150
- J. Patel
- $1,125 customer-pay balance
- closed 4:31 PM

Candidate B:
- RO-8031
- Daniel Harper
- 2020 Ford Escape
- A. Ross
- $1,100 customer-pay balance
- open

Do not add lost-response recovery to EX-104. This screen is only about ambiguous allocation.

## `04_PAYMENT_EVIDENCE_reference.png`
Binding pattern: Evidence Seam.

Use a routine payment such as PAY-1017 where the operator sees:
- PAYMENT: Captured
- DMS: Posted · Verified
- SETTLEMENT: Payout pending

Evidence may reveal:
- DMS POST committed
- response timed out
- recovery lookup using same operation key
- existing post found
- financial mutations = 1

Successful hidden recovery must not become an operator exception.

## `05_DEPOSIT_VARIANCE_reference.png`
Binding pattern: Settlement Ledger.

Canonical values from blueprint:
- expected payout: $18,742.61
- observed bank deposit: $18,717.61
- variance: $25.00

The image is layout/style guidance. Any extra generated bank names, transaction counts, payout IDs, or fee labels are not authoritative unless present in the blueprint/seed.

---

# Anti-AI design rules

Do not introduce:
- KPI card rows
- arbitrary charts
- fake percentages
- large repeated rounded cards
- excessive badges/pills
- gradients as decoration
- glassmorphism
- floating widgets
- empty right sidebars
- dark terminal panels by default
- 3D illustrations inside the app
- huge serif marketing headlines
- generic AI assistant/chatbot

Every visible panel must answer one of:
1. What business object am I looking at?
2. What needs my decision?
3. What evidence supports it?
4. What happens if I act?

If a panel answers none of these, remove it.
