# Guided review script

## Thirty-second overview

“PostOnce sits between a fictional dealership system, payment processor, and bank feed. It does not move money. It makes sure a payment result is posted once, unclear work is escalated, and the deposit reconciles before the day closes. This run is isolated and every record is synthetic.”

## Ninety-second run

### Start

Open `/demo`. Point out the two rooftops, twelve processor events, and `PROCESSING` close status. The chapter rail is both navigation and a record of what has executed.

### Routine automation

Run **Process routine payments**. Exact repair-order references match through deterministic rules. Allocations and outbound posting intent commit together; no person is asked to review obvious work.

### Duplicate event

Run **Deliver duplicate event**. The transport attempts increase to two while the mutation count stays one. Open the evidence drawer to show the common external event ID and returned original payment ID.

Plain-language point: “The message can arrive twice; the money is not counted twice.”

### Lost response

Run **Simulate lost response**. LegacyDMS saves the posting, but the first response is lost. Retry with the same destination key recovers the original posting.

Plain-language point: “We do not know whether the first call worked, so we ask with the same operation identity instead of blindly doing it again.”

### Ambiguous allocation

Open the ambiguous exception. Compare the two candidate repair orders and their deterministic signals. The system refuses to cross the confidence threshold.

Plain-language point: “Automation handles certainty; uncertainty becomes accountable human work.”

### Concurrent decision

Run the race. The guided action deterministically injects the two outcomes from the same visible version: one becomes the accepted resolution; the other receives a version conflict and the winning result. The API and PostgreSQL suites separately submit truly concurrent commands against the same guard.

Plain-language point: “Two people can click, but only one financial decision can win.”

### Reconciliation

Resolve the remaining exception if needed, then run settlement. Read the equation from left to right: gross captures, minus fees, minus refunds, equals the expected bank deposit. The close becomes `READY` only when both the money and blocking work agree.

### Evidence

Open the correlated audit trace. Show the processor input, allocation, outbox intent, DMS attempts, exception decision, and settlement check connected by stable IDs.

## Five-minute technical discussion

- Explain why REST commands match the workflow better than a flexible query surface.
- Explain inbox/outbox atomicity and why exactly-once network delivery is not claimed.
- Show the database uniqueness and version constraints, not only TypeScript checks.
- Explain why integer cents replace floating-point arithmetic.
- Show the guided rejected-decision evidence, then distinguish it from the true concurrent endpoint test: the stale caller receives the winning state, while durable rejected-attempt telemetry would require an outer observability transaction.
- Distinguish the deterministic matching engine from optional advisory explanations.
- State the public-demo limitation: session isolation is real, but the header is not production authentication.

## Reset behavior

**Reset run** replaces only the current browser session with the original deterministic scenario. It does not clear another reviewer's data. **Run full close** executes the same commands in sequence and remains idempotent if pressed again.
