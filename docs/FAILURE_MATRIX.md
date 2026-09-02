# Failure matrix

The demo makes failure a first-class product state. Each chapter answers four questions: what can fail, what is durable, how recovery works, and what the reviewer can prove afterward.

| Failure | Injected behavior | Safety mechanism | Reviewer evidence | Recovery result |
| --- | --- | --- | --- | --- |
| Duplicate processor webhook | One external event is delivered twice | Unique inbox identity and idempotent consumer | Two received attempts reference one payment mutation | Existing result is returned |
| DMS response disappears | Destination commits, caller receives no response | Stable destination operation key and replay lookup | One destination operation, two HTTP attempts | Retry returns original posting |
| Ambiguous payment reference | One payment plausibly matches two invoices | Confidence threshold and no-guess rule | Ranked candidates and contributing signals | Human chooses with an append-only decision |
| Concurrent resolution | The public guide injects the two same-version outcomes; HTTP/PostgreSQL tests submit genuinely concurrent commands | Optimistic concurrency and conditional update | Winning decision plus rejected `409` result | One allocation exists |
| Settlement variance | Deposit does not equal gross minus fees and refunds | Explicit close equation and blocking status | Component totals and variance | Close remains blocked |
| API temporarily unavailable | Browser cannot start a connected run | Honest, read-only bundled preview | Persistent availability banner | No local mutation is presented as server evidence |

## What is not claimed

- The network is not exactly once.
- The simulator is not a real DMS, processor, or bank integration.
- An accepted HTTP response is not treated as bank settlement.
- Advisory ranking is not allowed to create a financial mutation.
- Demo-session headers are not a substitute for production authentication or tenant authorization.
- The build persists outbound intent atomically, but it does not run a separate leased outbox worker or claim process-crash recovery between commit and delivery.
