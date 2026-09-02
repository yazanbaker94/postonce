# Architecture decisions

## REST over GraphQL

The workflow is command-oriented and the target role explicitly describes a REST backend. Endpoints express business operations, while read models provide complete views for the reviewer.

## PostgreSQL outbox and inbox over an external broker

The demo needs to prove atomic persistence and replay semantics, not distributed infrastructure breadth. A transactional outbox keeps the financial mutation and work intent in one commit. A durable inbox records consumed external identifiers. The design can later publish through a broker without changing domain invariants.

## At-least-once delivery with idempotent mutation

Exactly-once network delivery is not claimed. The transport may retry. Uniqueness constraints, operation keys, and destination lookup make repeated delivery safe.

## Deterministic matching before advisory AI

Exact references, amount, currency, customer, time window, and remaining balances produce a bounded candidate set. An assistant may explain ambiguous candidates, but only a deterministic rule or authorized human can create an allocation.

## Integer minor units

The demo uses integer cents with an explicit currency. Floating-point arithmetic is prohibited for financial totals.

## Synthetic adapters

LegacyDMS, Northstar Processor, and Prairie Bank are intentionally fictional. The demo exercises integration contracts and failure behavior without implying access to proprietary APIs.
