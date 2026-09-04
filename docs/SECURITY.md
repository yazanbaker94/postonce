# Security and data boundaries

PostOnce is a synthetic evaluation product. It intentionally has neither the data nor the authority required to process a real payment.

## Synthetic-data policy

- Every dealership, person, customer label, vehicle, repair order, payment, card fragment, payout, endpoint, and connected system is fictional.
- No primary account number, CVV, payment token, bank credential, real customer name, real vehicle identifier, production secret, or proprietary payload belongs in the repository or runtime.
- Monetary values are illustrative integer cents with an explicit currency.
- Synthetic card last-four values are presentation fixtures, not fragments of real cards.
- Screenshots, logs, test reports, and public issues must follow the same boundary.

## Evidence and error policy

- Integration evidence is allow-listed and size-bounded.
- Evidence may expose a fictional operation, status, timing, stable identity, correlation ID, and small sanitized body.
- Authorization headers, cookies, credentials, environment values, database connection details, stack traces, and arbitrary upstream bodies are excluded.
- Public errors return stable codes, safe messages, bounded details, and correlation IDs.
- Audit events identify synthetic operations and actors without containing sensitive personal data.

## Public deployment

- TLS terminates at the existing host Caddy service.
- The Compose gateway publishes only to `127.0.0.1:18044`.
- PostgreSQL and the API stay on private Compose networks; PostgreSQL is never published to the internet.
- The API and web client share one public origin. CORS is allow-listed for exceptional local development use.
- Security headers include frame protection, no-sniff, and a conservative referrer policy; the gateway applies the production content policy.
- Request bodies, workspace counts, session lifetimes, tracked rate-limit keys, and create/mutation windows are bounded.
- Health endpoints report readiness and synthetic-data status, not credentials or dependency addresses.
- Production pulls immutable GHCR image digests and does not build code on the shared VPS.

## Ingress identity boundary

The host proxy overwrites one private ingress-peer header from the actual TCP peer. The loopback gateway removes caller-controlled forwarding aliases. The API validates, canonicalizes, and hashes the resulting address before applying anonymous workspace-admission limits.

Public `Forwarded`, `X-Forwarded-For`, `CF-Connecting-IP`, and similar values are not accepted as identities. Behind Cloudflare, admission intentionally groups by the observed edge peer. That is a resource-control boundary, not authenticated end-user identity.

## Synthetic workspace sessions

`X-Demo-Session` isolates one anonymous synthetic workspace from another. It is not authentication, authorization, or a secure tenant credential. The browser stores the UUID locally, every repository query scopes by it, and reset changes only that workspace.

A real multi-tenant product would require authenticated identity, role-based command authorization, tenant-scoped database enforcement, session rotation/expiration, formal audit retention, administrative controls, abuse monitoring, and incident response.

## Financial-system caveats

PostOnce does not claim PCI DSS scope, SOC 2 compliance, money-transmitter status, or production suitability. A production implementation would also require:

- threat modeling against the actual processor, DMS, and bank contracts;
- signed webhook verification and replay windows;
- managed secret storage, key rotation, and least-privilege service identities;
- retention, deletion, backup, and restore policy verified through drills;
- an independently leased outbox worker with crash recovery;
- dependency and container scanning, alerting, observability, and independent security review;
- reconciliation and access controls approved by finance, security, legal, and compliance owners.

## Reporting

Do not place sensitive data in a public issue, screenshot, fixture, or log. Report a suspected vulnerability to the repository owner through a private channel.
