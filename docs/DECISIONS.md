# Architecture and product decisions

## Product-first public entry

The primary origin is the product's front door, so `/` resolves directly to `/app/close` and opens the operational workspace. The explanatory presentation remains available at `/case-study`, and the architecture evidence remains at `/architecture`. This resolves the earlier handoff tension between preserving a marketing root and requiring first-time visitors to land directly on Close in favor of the working product experience.

## Exception-first operator experience

Routine matching and recovery are system work, so the product opens on per-location close readiness and sends Maya only the items that need judgment. Duplicate delivery, safe retry, and other engineering behavior remain available as contextual evidence instead of operator-facing simulation controls.

## Operational close and payout reconciliation are separate timelines

A location can close after every in-scope DMS effect is verified and every blocking operational exception is cleared. A current-day payout may not be batched until later; making it a close prerequisite would manufacture false urgency. Deposits therefore have an independent state machine and can reconcile after operational close.

## Per-location readiness and immutable attestation

Group-level totals are useful for orientation but are too coarse for accountability. Readiness is calculated for each location. Closing captures the operator, time, business date, verified count, blocker count, and version as immutable proof of what was attested.

## REST commands over a flexible mutation surface

The write surface contains three explicit business commands: resolve an exception, close a location, and record a settlement adjustment. REST routes make those commands, their authorization boundary, validation rules, idempotency scope, and error states easy to inspect. Read routes return task-focused projections plus a complete workspace snapshot when the product boots.

## DMS verification before completion

Selecting a candidate is not equivalent to posting a payment. PostOnce persists the local decision and outbound intent, performs or recovers the destination write under a stable operation identity, and verifies the result before clearing the exception. This keeps the close board tied to observed dealership-system state rather than optimistic UI state.

## PostgreSQL inbox and outbox over an external broker

The product needs atomic persistence and replay semantics more than additional infrastructure breadth. A durable inbox identifies repeated external events. A transactional outbox keeps an accepted financial decision and its posting intent in one commit. A leased relay or broker can be added later without changing the domain invariants; this repository does not claim that worker exists.

## At-least-once delivery with idempotent mutation

Exactly-once network delivery is not claimed. Input can repeat and output responses can disappear. Unique provider-event identities, stable operation keys, command receipts, and payload equality make retries converge on the first accepted mutation.

## Optimistic versions plus serialized persistence

Every operator mutation carries the version the browser saw. PostgreSQL serializes competing workspace mutations; after the first decision wins, a stale command receives `VERSION_CONFLICT` and the current winning context. This protects business state while still giving the operator a useful explanation.

## Deterministic matching before advisory AI

Amount, currency, customer, location, department, time, remaining balance, and record status produce a bounded candidate set. The product explains those facts directly. Advisory AI may be explored later, but it cannot choose a target or mutate financial state.

## Integer minor units

All financial values use integer cents with explicit CAD in the fixture. Floating-point arithmetic is prohibited for allocations, payout arithmetic, variance, and close evidence.

## Append-only correction

An accepted record is not silently rewritten to make reconciliation pass. Refund links, settlement adjustments, close attestations, audit events, and command receipts preserve what happened. The Subaru payout keeps its original expected amount after the supported −$25.00 adjustment.

## Synthetic adapters and data

LegacyDMS, Northstar Processor, Prairie Bank, Northline Motor Group, Maya Chen, and every visible record are fictional. Deterministic adapters make integration and recovery behavior testable without implying access to proprietary APIs or exposing real payment/customer data.
