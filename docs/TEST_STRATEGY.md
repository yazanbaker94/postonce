# Test strategy

The test suite is organized around financial invariants and recovery behavior rather than maximizing a line-coverage number.

## Domain tests

- exact-reference matches allocate the intended invoice;
- ambiguous candidates never create an automatic allocation;
- allocations cannot exceed payment remainder or invoice balance;
- all reconciliation arithmetic uses integer cents;
- a close cannot become ready while a blocking exception remains;
- a one-cent or otherwise partial whole-payment resolution is rejected without mutation;
- reusing another allocation's operation key is rejected without mutation;
- repeated chapter commands return the original result.

## Repository and API tests

- the same processor external event can be delivered twice but creates one payment;
- the same idempotency key with a different payload is rejected;
- allocation and outbound intent commit together;
- a response lost after destination commit is recovered with the same key;
- the lost-response trace contains one failed observation and one safe replay, not a synthetic extra attempt;
- paired resolution commands at one version produce one success and one conflict;
- an independently supplied nonzero bank variance keeps the close blocked;
- another demo session cannot read or mutate the caller's records;
- errors are sanitized and include a traceable correlation ID;
- session reset affects only the current run.

PostgreSQL-backed tests verify database uniqueness and serialized `SELECT ... FOR UPDATE` behavior. In-memory repository tests provide fast feedback but are not accepted as sole evidence for concurrency or persistence claims.

## Interface tests

- a reviewer can start or resume an isolated run;
- chapter actions change the visible evidence and cannot be double-triggered;
- duplicate, lost-response, conflict, and reconciliation results are explained in plain language;
- the evidence drawer is keyboard accessible and restores focus;
- API failure switches to an explicitly read-only preview;
- responsive layouts preserve the close equation and chapter order;
- reduced-motion preference disables nonessential transitions.

## Production smoke checks

After deployment:

1. fetch `/health` and `/api/health` through the public TLS origin;
2. create a new demo session;
3. execute every chapter and assert the expected delivery/mutation counters, zero settlement variance, and passing evidence checks;
4. refresh and confirm the session state survives;
5. create a second session and confirm the runs differ;
6. capture desktop and narrow-viewport screenshots;
7. inspect the browser console and failed network requests;
8. verify the public repository and live URLs from a clean context.

No production smoke check uses real payment or customer data.
