# Security and data boundaries

PostOnce is a synthetic portfolio environment. It intentionally avoids the data and authority required to process a real payment.

## Data policy

- No primary account number, CVV, bank credential, real customer name, or payment token belongs in the repository or runtime.
- All visible payloads use fictional providers, endpoints, people, repair orders, and identifiers.
- Integration evidence is allow-listed and size-bounded. Headers, credentials, stack traces, environment values, and database details are excluded.
- Logs identify synthetic operations through correlation IDs, not personal data.
- Money is represented as integer cents and an explicit currency; values are illustrative only.

## Public deployment

- TLS terminates before the loopback-bound origin.
- PostgreSQL is private to the container network and is never published to the internet.
- The API and static client share one origin; CORS remains allow-listed for exceptional local development use.
- Security headers include a restrictive content policy, frame protection, no-sniff, and a conservative referrer policy.
- Request bodies, evidence responses, and public session counts are bounded.
- The host proxy overwrites one private ingress-peer header from the actual network peer; the loopback gateway strips public forwarding identities, and the API hashes the validated address for admission limiting.
- Health endpoints reveal readiness, not secrets or dependency connection strings.
- Errors return stable public codes and correlation IDs without stack traces.

## Demo sessions versus production identity

`X-Demo-Session` provides isolation for anonymous synthetic runs. It is not authorization. A real multi-tenant product would require authenticated identities, role-based command authorization, tenant-scoped database enforcement, session expiration, rate limits, audit retention policy, and a formal operational access model.

## Financial-system caveats

PostOnce does not claim PCI DSS scope, SOC 2 compliance, money-transmitter status, or suitability for production finance. A real implementation would require threat modeling with the actual processor/DMS contracts, secret management, signed webhook verification, key rotation, data retention controls, alerting, backups restored in drills, dependency scanning, and independent security review.

## Reporting

This repository is a portfolio project. Do not send sensitive data in a public issue. Contact the repository owner privately for a suspected vulnerability.
