# ADR 0003: Separate HTTP commerce simulator

Status: Accepted

The demo commerce service runs as a separate FastAPI process with its own SQLite database. ecommerce-support-automation calls it through the CommerceProvider interface and uses its order state as authoritative for investigations, execution revalidation, refund acceptance, and settlement. The local application database is a queryable snapshot and operation/audit ledger. No real store or payment API is contacted.
