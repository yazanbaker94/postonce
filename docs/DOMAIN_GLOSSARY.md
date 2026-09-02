# Domain glossary

PostOnce uses a deliberately small financial vocabulary.

| Term | Plain-language meaning in this demo |
| --- | --- |
| Repair order / invoice | The amount the fictional dealership system says a customer owes. |
| Capture | A successful customer payment reported by the fictional processor. |
| Allocation | The explicit link assigning some or all of a payment to an invoice. |
| Posting | Writing the accepted payment result back to the fictional dealership system. |
| Settlement | The processor's grouped accounting of captures, refunds, and fees. |
| Deposit | The net amount the fictional bank reports receiving. |
| Reconciliation | Proving the component records explain the amount deposited. |
| Exception | A case the deterministic rules cannot safely finish without review. |
| Inbox | Durable identity for an incoming message, used to recognize repeat delivery. |
| Outbox | Durable intent to notify another system after local state commits. |
| Idempotency key | A stable operation identity that makes a retry return the first result instead of doing the work twice. |
| Correlation ID | A trace identifier connecting related events and integration attempts. |
| Optimistic concurrency | Accepting a decision only if the record is still at the version the reviewer saw. |
| Compensating event | A new record correcting prior history without silently rewriting it. |

## The close equation

```text
gross captures - processor fees - refunds = expected bank deposit
```

The sign convention is explicit: `feeCents` and `refundCents` are positive component amounts that are subtracted from gross. `varianceCents` is `expectedDepositCents - bankDepositCents`; zero means the settlement balances.
