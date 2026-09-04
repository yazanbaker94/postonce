# Failure and recovery matrix

PostOnce treats failure as domain state and evidence, not as a sequence of controls an operator must run. Routine transport failures recover below the task surface; unresolved business uncertainty appears in Exceptions.

| Condition | Durable guard | Recovery or rejection | Operator visibility | Business effect |
| --- | --- | --- | --- | --- |
| A processor event is delivered twice | Unique provider/event inbox identity | Return the existing payment and record the repeated attempt | `PAY-1006`, Activity, and Integrations show two deliveries with one mutation | No double-counted payment |
| The DMS commits but its response is lost | Stable posting operation key plus destination lookup | Retry with the same key and recover the existing posting | `PAY-1017` shows the response-recovery evidence seam | One DMS financial effect |
| A payment has two plausible repair orders | Bounded candidate evidence and no-guess rule | Open `EX-104` for controller selection | Exception detail compares amount, customer, location, department, timing, and status | Ford stays blocked until the selected write verifies |
| A refund lacks its original transaction | Candidate restriction and immutable refund-link identity | `EX-105` links the refund to a supported historical payment | Exception detail shows exact and alternative candidates | History remains intact; the verified link clears one blocker |
| A payment is the second part of a split tender | Remaining-balance and total-allocation constraints | `EX-106` applies only the exact $2,450.00 remainder | Exception detail shows the existing and new tenders | The record reaches its $4,000.00 customer-pay total without over-allocation |
| Two operators act on the same version | Serialized persistence plus expected version | First accepted command wins; stale command gets `409 VERSION_CONFLICT` | The browser reloads the winning record and reports the conflict | No duplicate allocation, link, close, or adjustment |
| An idempotency key is reused with changed input | Append-only command receipt with payload equality | Reject with `409 IDEMPOTENCY_KEY_REUSE` | Safe error with correlation ID | The original accepted result remains authoritative |
| A location is closed before it is ready | Verified-count and blocker invariants | Reject with `CLOSE_BLOCKED` | Close action stays unavailable and API explains the remaining proof | No false close attestation |
| A prior payout differs from the bank deposit | Immutable source records and explicit payout arithmetic | Keep payout in `VARIANCE` until supported adjustment or new evidence | Subaru deposit shows the $25.00 difference and its assessment notice | Payout stays unreconciled; today's operational close is unaffected |
| The workspace API is unavailable | Server-authoritative mutations and no browser financial fallback | Disable mutations and offer retry | Persistent unavailable banner or page state | No local state is presented as durable evidence |
| Public workspace traffic is excessive | Bounded create/mutation windows and session retention | Return `429` with retry information | Safe error only | Shared-host resources remain bounded |

## What PostOnce claims

- A logical processor input changes financial state at most once.
- A DMS retry with the original operation identity converges on the existing effect.
- Only one command against an expected version can win.
- A blocker clears only after the dealership-system result is verified.
- A location close is immutable and independent from later settlement timing.
- A payout is reconciled only when adjusted expected and observed deposit agree.

## What PostOnce does not claim

- The network delivers exactly once.
- A simulator proves compatibility with a real DMS, processor, or bank.
- A successful DMS posting proves that a bank deposit arrived.
- Anonymous workspace headers are production authentication or authorization.
- The current in-process synthetic adapter is a crash-resumable outbox worker.
- Settlement completion and operational close share one state machine.
- Any visible person, payment, vehicle, business, or financial record is real.
