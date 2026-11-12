# ADR 0002: Human approval for financial mutations

Status: Accepted

Refund proposals require a reviewer session. Approval checks the proposal state, order version, policy version, author separation, and remaining balance. Execution repeats the safety checks and requires an idempotency key. The simulator reports pending acceptance separately from settlement.
