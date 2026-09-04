# PostOnce Implementation Rules

## Authority order

When sources conflict, use this order:

1. `CANONICAL_DECISIONS.md` — conflict resolution and final product decisions
2. `POSTONCE_PRODUCT_BLUEPRINT.md` — behavior, data, fixtures, state transitions, routes, terminology
3. `DESIGN_SYSTEM.md` — visual rules and interaction patterns
4. `/design/*.png` — layout/composition references
5. existing implementation — only for code/infrastructure that remains compatible

Generated screenshot text is never authoritative data.

## Existing engineering to preserve

Preserve the current correctness machinery wherever possible:
- Postgres constraints
- integer-cent money
- session isolation
- duplicate event protection
- stable outbound operation keys
- inbox/outbox behavior
- optimistic concurrency
- integration attempts
- append-only audit evidence
- DMS simulator
- bank/settlement simulator
- existing correctness/concurrency tests

Do not remove a safety invariant merely because the new product UI no longer exposes the old demo scenario.

## Product experience to remove

The operator product must not expose:
- guided chapters
- Start demo
- run all chapters
- Failure Lab
- simulate duplicate
- simulate timeout
- simulate concurrency race
- architecture as an operator workflow
- engineering-evidence dashboard

Routine automation should already have run when the workspace opens.

## Truthfulness

Do not invent:
- customers beyond deterministic synthetic fixtures
- throughput metrics
- uptime/SLA
- revenue
- processor partnerships
- OEM affiliation
- certifications
- bank partnerships
- industry benchmark percentages

All visible data must come from the deterministic synthetic workspace or be clearly static explanatory copy.

Do not use Toyota/Ford/Subaru corporate logos. The fictional rooftop names may remain, but use neutral initials/marks.

## UX behavior

### Close
- readiness recalculates server-side
- payout pending does not block operational close
- blocked Ford row links directly to its three work items
- successful closure appends audit evidence

### Exceptions
- full work slip clickable
- avoid repeated bright Review buttons
- sort/filter must work
- resolved items disappear from open queue or move to Resolved

### Exception detail
- display business evidence before technical evidence
- financial action is explicit
- optimistic version required on mutation
- stale version reloads current state with human message

### Payment detail
- normal business object first
- Evidence collapsed by default
- successful retry/recovery is not framed as an operator failure

### Deposits
- expected and observed amounts remain separately visible
- adjustments append; source evidence does not mutate
- recalculation follows stored evidence

## Responsive implementation

Desktop references are binding at ~1536×1024.

Mobile should preserve hierarchy, not literal columns.

Suggested mobile adaptation:
- nav becomes compact bottom/sheet/menu navigation
- Close rails stack but preserve left-to-right stage sequence
- Work Slips stack naturally
- Decision Bench becomes source → evidence rows → candidate selector → selected record
- Evidence Seam becomes full-width inline expansion
- Settlement ledger preserves arithmetic vertically

Do not make desktop worse just to avoid a dedicated mobile layout.

## Visual QA

For each reference screen:
1. run app at 1536×1024
2. seed/reset deterministic workspace
3. navigate to matching state
4. capture screenshot
5. compare side-by-side with supplied reference
6. fix geometry before micro styling

Compare:
- sidebar width
- topbar height
- primary object position
- information density
- divider placement
- amount typography
- whitespace
- semantic color usage
- action placement

Do not stop at “similar.” Aim for the same visual grammar.

## Accessibility

- semantic buttons and links
- keyboard focus visible
- color is never the sole status signal
- tabular amounts have accessible labels
- evidence accordion keyboard-operable
- destructive/financial actions clearly named
- sufficient contrast

## Testing

The vertical slice from the blueprint is mandatory:

`Close → Ford → EX-104 → EX-105 → EX-106 → Ford READY → Close Ford → Subaru payout → $25 adjustment → RECONCILED`

Additionally preserve tests proving:
- duplicate delivery mutates once
- lost response yields one DMS mutation
- operation identity stays stable
- stale resolution rejected
- adjustment history append-only
