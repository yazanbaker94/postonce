# Reviewing PostOnce

[Open the demo](https://postonce.swoop.video) · [Screenshot tour](SCREENSHOTS.md) · [Back to README](../README.md)

PostOnce is a working evaluation of dealership payment posting, exception handling, daily close, and payout reconciliation. It was built around the engineering concerns in Anchorbase's Software Engineer role: clear operator workflows, typed boundaries, relational persistence, concurrent decisions, failure handling, and delivery. It is an independent project, not an Anchorbase integration or an assertion about Anchorbase's internal architecture.

## Five-minute product walkthrough

1. **Close:** compare Toyota's ready state with Ford's three blockers. Bank payout timing does not control operational readiness.
2. **Exceptions:** resolve the ambiguous $1,125 payment, link the $219 refund, and allocate the $2,450 second tender. Each decision must reach a verified posting before clearing.
3. **Close:** Ford becomes ready at 27 verified postings and zero blockers. Confirm the close to create its attestation.
4. **Deposits:** reconcile Subaru's $25 shortfall using the network-assessment evidence. The original expected amount remains intact; the correction is a separate adjustment.
5. **Activity / Payments / Integrations:** inspect who changed what, the payment's posting evidence, and the simulated communication attempts. Search can take you directly to a customer or record.

The [operator walkthrough](OPERATOR_WALKTHROUGH.md) includes exact fixture values and expected outcomes. Use the profile menu to reset your isolated demo workspace. All money in the fixture is CAD.

## Suggested code reading order

| Question | Start here | What to inspect |
| --- | --- | --- |
| What is the data contract? | [Shared schemas](../packages/contracts/src/index.ts) | Runtime validation and explicit domain states. |
| What makes a command valid? | [Domain engine](../apps/api/src/demo/domain/demo.engine.ts) | Amounts, relationships, versions, idempotency, and append-only evidence. |
| How are concurrent writes persisted? | [PostgreSQL repository](../apps/api/src/demo/repositories/postgres-demo.repository.ts) | Workspace locking and transactional persistence. |
| What does the relational model enforce? | [SQL migrations](../database/migrations) | Constraints, stable identities, and normalized evidence tables. |
| What is exposed over HTTP? | [Controller](../apps/api/src/demo/demo.controller.ts) and [API contract](API_CONTRACT.md) | Read projections, business commands, and failure responses. |
| How does the operator see the result? | [Product UI](../apps/web/src/product/ProductApp.tsx) | API-returned state, evidence disclosure, and clear decision/confirmation flows. |
| What proves the invariants? | [Engine tests](../apps/api/test/demo.engine.spec.ts), [Postgres tests](../apps/api/test/postgres.repository.spec.ts), [browser tests](../apps/web/e2e) | Success paths, replay, conflicts, persistence, and responsive workflows. |
| How is it delivered? | [Release workflow](../.github/workflows/release.yml) and [operations guide](../infra/README.md) | Verification before image publication, digest-pinned deployment, bounded shared-host resources. |

## Decisions worth discussing

- **Operational close is not bank settlement.** Separate state machines prevent a normal payout delay from becoming a false close blocker.
- **A click is not proof of posting.** Completion requires the simulated destination effect to be verified.
- **Retries are expected.** Stable identities and replay receipts target one domain effect, rather than claiming exactly-once network delivery.
- **Concurrent operators need a defined winner.** Expected versions and PostgreSQL serialization reject stale commands instead of silently overwriting them.
- **Corrections retain the original facts.** Adjustments explain a discrepancy without rewriting the source payout.

See [architecture](ARCHITECTURE.md), [decisions](DECISIONS.md), and the [failure matrix](FAILURE_MATRIX.md) for the detailed reasoning.

## What this evaluation does not prove

The deployed application has a real API and PostgreSQL persistence, but its financial systems and incoming events are deterministic simulations. The matching candidates and recovery examples are fixture-driven; this is not a measured production matching engine. The outbox is modeled within request-driven demo execution, not serviced by an independently leased worker. Anonymous workspace isolation is not authentication or production tenant authorization.

No live funds move. No real bank, processor, or dealership access is claimed. There is no autonomous AI making financial decisions. Production work would require actual adapter contracts, webhook verification, authentication/authorization, worker crash recovery, operational monitoring, and security/compliance review. [Security boundaries](SECURITY.md) documents the remaining work explicitly.

## Reproduce the checks and screenshots

Follow [local setup](../README.md#run-locally), then run `npm run verify` after installing Chromium. PostgreSQL locking/persistence tests require the database configuration described in [Test strategy](TEST_STRATEGY.md); CI provides it.

With the local API and web app running, use:

```bash
npx playwright install chromium
npm run screenshots:review
```

This captures a fresh synthetic workspace through actual UI interactions. It does not mock responses or alter records to manufacture a screenshot. The [gallery](SCREENSHOTS.md) explains the captured states and dimensions.
