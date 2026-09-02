# PostOnce database

PostOnce uses explicit, ordered PostgreSQL migrations. Run them with:

```sh
DATABASE_URL=postgres://... npm run migrate --workspace @postonce/api
```

The JSON document in `demo_sessions.state` is a disposable, session-isolated read model so the reviewer UI can render in one request. The same transaction mirrors domain writes into relational tables with the actual constraints: unique processor inbox events, unique allocation and destination operation keys, bounded integer-cent allocations, an outbox, optimistic exception versions, reconciled settlement arithmetic, and append-only attempt/audit evidence.

The fictional fixture contains no PAN, cardholder data, real customer data, or real integration credentials.
