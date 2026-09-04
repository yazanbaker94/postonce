# PostOnce Canonical Decisions

This addendum resolves conflicts and gaps in the original product handoff. It is the highest-authority product document for this rebuild. Where it is silent, use `POSTONCE_PRODUCT_BLUEPRINT.md`, then `DESIGN_SYSTEM.md`, then the PNG references.

## Delivery scope

- Ship the working product and the finished visual system in the same delivery.
- Build and verify behavior first internally, then complete visual QA before release.
- The hero journey is `Close -> EX-104 -> EX-105 -> EX-106 -> Ford READY -> Close Ford -> Subaru adjustment -> RECONCILED`.
- Payments, Activity, and Integrations remain useful secondary projections. Do not add analytics, AI, dead controls, or speculative workflows.

## Canonical workspace

- Organization: Northline Motor Group
- Active persona: Maya Chen, Group Controller
- Business date: Friday, September 4, 2026
- Initial workspace time: 4:55 PM
- Timezone: `America/Edmonton`
- Currency: CAD
- Prior Subaru payout date: Thursday, September 3, 2026
- A server-returned `workspaceAsOf` controls deterministic relative times.

The default exception order is Newest: EX-104, EX-105, EX-106. Their initial ages are 18, 37, and 46 minutes. Oldest reverses the order.

## Operational truth

- Operational close and payout settlement are independent timelines.
- The Close rail connects Payments, DMS posting, Open work, and Close. Settlement is visible but visually detached and never blocks same-day operational close while it is merely payout pending.
- Settlement variance work lives in Deposits, not the operational exception queue.
- `VERIFIED` is the terminal DMS state; the business UI renders `POSTED - VERIFIED`.
- Each Ford exception remains blocking until its resulting accounting effect is verified. Counts and readiness update only after verification.
- Closing a location creates an immutable attestation snapshot. Late activity must not rewrite it silently.

## Deterministic fixtures

- Maintain a checked-in manifest for all 62 Friday payments. Per-location counts, department counts, and signed totals must match the blueprint exactly.
- Historical candidate payments may exist outside those 62 Friday items.
- Ford EX-105 and the Subaru prior-payout refund component are distinct records even though both are $219.
- Screenshot-only customer IDs, VINs, bank details, transaction counts, filenames, and fee formulas are not fixtures.
- PAY-1017 must receive an explicit canonical fixture before its fields appear in the UI.
- Customer-plus-amount matching is advisory only. Automatic posting requires a trusted exact source reference.

## Mutations and evidence

- Every financial mutation requires an idempotency key; exception mutations also require an expected version.
- A submitted resolution locks its controls and enters a posting state. It resolves only when the dealership-system effect is verified.
- EX-105 always produces one verified accounting correction; it is not optional.
- The Subaru reconciliation appends a signed `-$25.00` network-assessment adjustment supported by a seeded source record.
- Preserve the original expected payout. Show original expected, adjustment, adjusted expected, observed deposit, and resulting variance separately.
- Use transparent `Suggested match` or `Strong match` language. Do not claim AI.

## Visual system

- Screens 01, 02, 03, and 05 define the canonical application shell. Screen 04 defines payment-detail and Evidence Seam composition only.
- Navigation is always Close, Exceptions, Payments, Deposits, Activity, Integrations.
- Candidate selection uses cobalt. Green is reserved for proven terminal state.
- Evidence is collapsed by default and expands inline without covering history.
- All visible controls must work. Otherwise render static information or remove the control.
- Use darker accessible foreground tokens for muted, review, danger, and control-border text; keep the original brighter colors for fills and decorative marks.
- Require visible keyboard focus, 44px targets, semantic tables and radio groups, tabular money, and announced readiness/reconciliation changes.

## Release boundary

- Deploy only as the isolated Compose project `postonce` under `/opt/postonce`, bound to `127.0.0.1:18044`, with the single Caddy site fragment `/etc/caddy/sites/postonce.caddy`.
- Never modify or prune unrelated VPS applications, containers, images, volumes, Caddy fragments, systemd units, or data.
- PostOnce cleanup and retention must be explicitly project-scoped. Never run a global Docker prune on the shared VPS.
