# Security model and demo limits

## Trust boundaries

- Ticket text is untrusted input. It can describe a request but cannot authorize an operation or alter policy.
- Demo customer and order ownership comes from seeded records, never from claims in the message.
- Fixture classification is deterministic and labelled `DEMO_FIXTURE`; it is not model inference.
- Only `REVIEWER` and `ADMIN` sessions can approve, execute, or settle simulated refunds. The backend checks role and proposal state.
- Refund amount must equal the approved proposal and remain within the order balance. An idempotency key is unique and its request fingerprint must match on replay.

## Demo authentication

Login uses fixed demo usernames (`agent`, `reviewer`, `admin`) and the shared password `demo`. Random bearer tokens are stored as SHA-256 hashes and expire after eight hours. This authentication is for local demonstration only; it does not provide production identity, MFA, rate limiting, or tenant isolation. Configure CORS narrowly and do not expose this demo API publicly.

## Data and financial semantics

Seeded records use fictional `.test` emails. No payment credentials or real commerce connection are used. A simulator acceptance is recorded as `PENDING`; a separate settlement action records `SETTLED`. This reference implementation does not prove real payment reversibility, compliance, or operational suitability.

When model mode is enabled, ticket subject and body are sent to the configured OpenAI-compatible endpoint. Use fictional data for demonstrations, review the provider's data handling before enabling it, and keep any API key in the API service environment. The browser does not receive the provider key.

## Production deployment requirements

Production requires secure identity, CSRF protection if cookies are used, rate limits, tenant-scoped query enforcement, secret management, durable PostgreSQL transactions, an independent execution worker, automated provider reconciliation, and an independent security review. The optional model adapter validates structured output but does not prove that generated explanations are grounded. Fixture tests do not demonstrate universal prompt-injection resistance.
