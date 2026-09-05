# Product layout review — 2026-09-05

Reviewed all six workspace sections, all three exception decisions, payment evidence,
and pending, variance, and reconciled deposits against the existing reference style.
The review also covered expanded filters, integration attempts, resolved exceptions,
the Close confirmation dialog, and mobile navigation.

## Corrections

- Restored native payment table cells; customer and location no longer stack in one column.
- Scoped text-stack styles to inner content so row chevrons stay centered.
- Gave payment filters readable widths and aligned their labels and controls.
- Added labeled payment records below 800px instead of a wide, horizontally scrolling ledger.
- Aligned deposit amounts beneath their headings and improved activity row spacing.
- Removed the empty fifth column from tablet Close rails.
- Kept tablet exception filters inside the viewport and gave timestamps enough room.
- Made candidate comparisons fit phones and use the full evidence area for a single candidate.
- Kept expanded payment results and integration attempts readable on narrow screens.
- Limited circular icon styling to icons, fixing resolved/reconciled status panels.
- Added explicit empty states for missing payout evidence and integration attempts.
- Matched Needs review to the existing amber review treatment.

## Verification

- Full repository verification, including the canonical financial workflow.
- 18 Playwright tests across desktop, mobile, and screenshot projects.
- Browser inspection of 13 routes at 1536, 1000, and 390px, plus a breakpoint sweep
  at 1280, 1101, 800, 760, 621, and 360px.
- Open-state checks for exception filters, payment evidence, and integration attempts.
- Explicit regression assertions for table/header alignment, centered chevrons,
  mobile record containment, tablet rail distribution, and filter placement.

The dense payment table retains horizontal scrolling at intermediate desktop/tablet
widths when needed; phones receive the labeled record layout. Screenshots 01–09 in
`docs/screenshots/product/` cover the reference flows and all additional main sections.
