# Product screenshot tour

[Live demo](https://postonce.swoop.video) · [Reviewer guide](REVIEWER_GUIDE.md) · [README](../README.md)

These are actual browser captures of the implemented product, not design mockups. All people, payments, and connected systems are fictional. Desktop captures use a 1536 × 1024 viewport; mobile captures use 390 × 844. Most desktop images include the full page; long payment ledgers, search, the confirmation dialog, and mobile captures show the viewport. Click any image to inspect it at full resolution.

Captured September 5, 2026. The business date and clock inside the demo are deliberately fixed. The sequence begins in a fresh workspace, then records real demo decisions before capturing their results. Local capture uses the same application code with disposable in-memory storage; the deployed demo uses PostgreSQL. These images demonstrate UI behavior, not production integration certification.

## Main screens

### 1. Daily close

Toyota and Subaru are ready. Ford has three blocking exceptions. Pending payouts are tracked separately.

![Daily close across three dealership locations](screenshots/review/01-close.png)

### 2. Exceptions queue

Ford's open work, with the reason, amount, customer, age, and next action for each item.

![Ford exceptions queue](screenshots/review/02-exceptions.png)

### 3. Payment ledger

Customer and record context alongside posting and settlement status. This viewport shows the beginning of the 62-payment ledger.

![Payment ledger with aligned columns and row actions](screenshots/review/06-payments.png)

### 4. Deposit ledger

Expected and observed deposits, including pending, matched, and variance states.

![Deposit ledger](screenshots/review/10-deposits.png)

### 5. Activity

The history after completing the three exceptions, closing Ford, and recording the supported settlement adjustment. Human decisions and system events retain their actors.

![Audit activity after the operator journey](screenshots/review/20-activity.png)

### 6. Integrations

The three simulators, expanded recent attempts, identity guards, and the matching-policy explanation.

![Integration status and expanded attempts](screenshots/review/14-integrations.png)

## Decision screens

### 7. Ambiguous payment match

Compare two repair orders. The exact amount and timing support the suggested candidate, but the operator must confirm.

![Payment match decision with two repair orders](screenshots/review/03-payment-match.png)

### 8. Refund-to-original-payment link

Identify the purchase behind an existing refund. This records the relationship; it does not issue another refund.

![Refund linking decision](screenshots/review/04-refund-link.png)

### 9. Split tender

The existing $1,550 and incoming $2,450 payments together cover one $4,000 repair order. They remain separate transactions.

![Split tender allocation decision](screenshots/review/05-split-tender.png)

## Payment detail and evidence

### 10. Routine payment

The normal received → matched → posted → verified history, plus business details.

![Routine payment detail](screenshots/review/07-payment-detail.png)

### 11. Lost-response recovery

Expanded evidence shows the simulated destination committed, its response was lost, and the repeated operation found the existing effect.

![Payment recovery evidence showing one effect across attempts](screenshots/review/08-payment-recovery.png)

### 12. Duplicate-delivery payment

The payment record and expanded technical identifiers for the duplicate-delivery example. Its recovery event is also recorded in Activity; repeat delivery did not create a second payment.

![Duplicate-delivery example with technical identifiers](screenshots/review/09-duplicate-delivery.png)

## Settlement workpapers

### 13. Unexplained variance

The expected deposit is $25 above the bank observation. The network-assessment notice supports a separate adjustment.

![Subaru settlement variance workpaper](screenshots/review/11-deposit-variance.png)

### 14. Already-matched deposit

Toyota's prior-day expected and observed amounts agree; no controller adjustment is required.

The fixture does not provide this payout's component breakdown, so those fields say “Not available” rather than falsely reporting zero.

![Matched Toyota deposit](screenshots/review/12-matched-deposit.png)

### 15. Pending payout

No bank receipt is claimed before an observation exists.

![Pending payout workpaper](screenshots/review/13-pending-deposit.png)

## Search and completed states

### 16. Global search

Searching Daniel Harper returns grouped payments and dealership records without changing business state.

![Global search results](screenshots/review/15-search.png)

### 17. Verified exception resolution

The accepted decision identifies the operator and verifies the dealership-system write.

![Resolved payment exception](screenshots/review/16-resolved-exception.png)

### 18. Close confirmation

The operator reviews the payment count, verified postings, and blockers before signing off.

![Close location confirmation dialog](screenshots/review/17-close-confirmation.png)

### 19. Closed location

Ford is closed by Maya Chen while its payout remains pending.

![Ford closed with payout still pending](screenshots/review/18-closed-location.png)

### 20. Supported adjustment recorded

The original expected amount remains visible. The adjusted expectation equals the bank observation and the variance is zero.

![Reconciled Subaru deposit after supported adjustment](screenshots/review/19-reconciled-adjustment.png)

## Architecture and responsive layouts

### 21. Architecture screen

The public technical explanation of delivery semantics, system boundaries, and evidence.

![Architecture explanation screen](screenshots/review/21-architecture.png)

### 22. Mobile close

![Daily close at phone width](screenshots/review/22-mobile-close.png)

### 23. Mobile payment ledger

Rows become labeled records at phone widths rather than a clipped desktop table. This view is scrolled past the filters to the first records.

![Payment ledger at phone width](screenshots/review/23-mobile-payments.png)

### 24. Mobile decision screen

Scrolled to the candidate comparison, with the normal fixed mobile navigation still visible.

![Payment comparison and decision at phone width](screenshots/review/24-mobile-decision.png)

## Reproduce

Run the local API and web app using the [README](../README.md#run-locally), then:

```bash
npx playwright install chromium
npm run screenshots:review
```

The capture script starts a new anonymous workspace and executes only synthetic actions in that workspace. It checks page loads, expected completion states, and browser errors. An optional base URL can be passed as `npm run screenshots:review -- https://your-demo-host`.

This directory is the current reviewer gallery. Older images under `screenshots/product` support the existing test/capture workflow; images under `screenshots/web` are historical artifacts and are not the current product tour.
