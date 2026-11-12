# Contributing

Thanks for contributing. Keep policy decisions deterministic and make evidence and authorization checks explicit. Avoid putting business rules in prompts or exposing credentials to the browser.

## Local setup

- Python 3.12 or newer
- Node.js 22 or newer
- pnpm 12.3.4
- Make

Run `make install`, then `make test`. Start all local services with `make dev`, or start the API, simulator, and frontend separately with `make api`, `make simulator`, and `make web`.

Docker Compose reads configuration from a root `.env` file. Copy `.env.example` to `.env` before using optional provider settings with Compose. For Makefile-based development, export the required variables in the shell that starts the service. Keep real credentials out of source control and configure provider keys only for the API process.

## Changes

- Add focused tests for policy, money, role, idempotency, and failure behavior.
- Use integer minor units for monetary values.
- Keep demo data fictional and preserve the distinction between accepted and settled refunds.
- Update docs when changing simulator semantics or security boundaries.
- Do not commit environment files other than `.env.example`, credentials, customer data, or real payment information.

## Pull requests

Describe the behavior changed, validation run, and any unsupported or unverified scenarios. Tests requiring paid services are not acceptable for the core CI path.
