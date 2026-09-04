# Domain glossary

PostOnce uses a small operational and financial vocabulary. Every example in this repository is synthetic.

| Term | Meaning in PostOnce |
| --- | --- |
| Location / rooftop | One dealership operating unit that closes independently. |
| DMS record | A fictional repair order, parts ticket, or deal owned by the dealership system. |
| Payment | A capture or refund event reported by the fictional processor. |
| Allocation | The immutable link assigning an amount from a payment to a DMS record. |
| Refund link | The immutable relationship between a refund and its original payment. |
| DMS posting | The outbound financial effect written to the fictional dealership system. |
| Verified posting | A posting whose destination result has been confirmed; only verified effects count toward close readiness. |
| Exception | A payment decision deterministic rules cannot safely finish without controller judgment. |
| Blocking exception | Open operational work that prevents its location from becoming ready. |
| Operational close | Per-location proof that every in-scope payment has a verified DMS effect and no blocking exception remains. |
| Close attestation | Immutable record of who closed a location, when, for which business date, counts, and version. |
| Processor payout | The processor's accounting of captured payments, refunds, fees, and supported adjustments. |
| Deposit | The net amount the fictional bank reports observing. |
| Payout reconciliation | Proof that adjusted expected payout equals the observed deposit. It is separate from operational close. |
| Settlement adjustment | An append-only, source-supported correction to the expected payout model; it does not rewrite source evidence. |
| Payout pending | Normal state before the processor batches a business day. It is not a close blocker. |
| Variance | The difference between adjusted expected payout and observed deposit. |
| Inbox | Durable identity for an incoming message, used to recognize repeated delivery. |
| Outbox | Durable intent to notify another system after the accepted local decision commits. |
| Idempotency key | Stable command identity that makes an identical retry return the first result instead of applying twice. |
| Correlation ID | Trace identifier connecting related events, commands, and integration attempts. |
| Expected version | The record version an operator saw; a mismatch rejects a stale decision. |
| Compensating record | New evidence that corrects accepted history without silently rewriting it. |
| Evidence seam | Contextual view connecting a business record to the sanitized technical attempts that explain its outcome. |

## Payout reconciliation equation

```text
captured payments - refunds - processor fees + adjustments = adjusted expected payout
adjusted expected payout - observed bank deposit = variance
```

Refund and fee fields are positive component amounts that are subtracted. An assessment adjustment in the canonical fixture is signed `-2500` cents. A zero variance is required for `RECONCILED`.

This equation does not determine operational close readiness. Close readiness uses verified DMS postings and blocking operational exceptions for one location and business date.
