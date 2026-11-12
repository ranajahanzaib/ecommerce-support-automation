from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

DB_PATH = Path(os.getenv("SIMULATOR_DB", "./simulator.db"))
FAULTS_ENABLED = os.getenv("SIMULATOR_FAULTS_ENABLED", "false").lower() == "true"
LOCK = threading.RLock()
app = FastAPI(title="ecommerce-support-automation Commerce Simulator", version="0.1.0")


@contextmanager
def connect():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB_PATH, timeout=15, check_same_thread=False)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def today() -> date:
    return datetime.now(UTC).date()


def initialize() -> None:
    with connect() as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,customer_id TEXT NOT NULL,number TEXT NOT NULL UNIQUE,currency TEXT NOT NULL,total_minor INTEGER NOT NULL,refunded_minor INTEGER NOT NULL DEFAULT 0,pending_minor INTEGER NOT NULL DEFAULT 0,delivered_at TEXT NOT NULL,version INTEGER NOT NULL,items TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS refunds(id TEXT PRIMARY KEY,idempotency_key TEXT NOT NULL UNIQUE,fingerprint TEXT NOT NULL,order_id TEXT NOT NULL REFERENCES orders(id),amount_minor INTEGER NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS returns(id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES orders(id),status TEXT NOT NULL,created_at TEXT NOT NULL);
        """)
        if db.execute("SELECT COUNT(*) FROM orders").fetchone()[0] == 0:
            seed(db)


def seed(db: sqlite3.Connection) -> None:
    current = today()
    standard = json.dumps([{"title":"Everyday Tote","sku":"TOTE-01","quantity":1,"unit_price_minor":4500,"final_sale":False}])
    pouch = json.dumps([{"title":"Canvas Pouch","sku":"POUCH-02","quantity":1,"unit_price_minor":2100,"final_sale":False}])
    final_sale = json.dumps([{"title":"Clearance Mug","sku":"MUG-FINAL","quantity":1,"unit_price_minor":1800,"final_sale":True}])
    records = [
        ("ord_1048","cus_100","1048","USD",4500,0,0,(current-timedelta(days=12)).isoformat(),1,standard),
        ("ord_1049","cus_100","1049","USD",2100,0,0,(current-timedelta(days=6)).isoformat(),1,pouch),
        ("ord_2044","cus_200","2044","USD",8900,8900,0,(current-timedelta(days=45)).isoformat(),2,standard),
        ("ord_2045","cus_200","2045","USD",1800,0,0,(current-timedelta(days=4)).isoformat(),1,final_sale),
        ("ord_3001","cus_300","3001","USD",12000,0,0,(current-timedelta(days=8)).isoformat(),1,standard),
    ]
    db.executemany("INSERT INTO orders VALUES(?,?,?,?,?,?,?,?,?,?)", records)


initialize()


class RefundCreate(BaseModel):
    order_id: str
    amount_minor: int = Field(gt=0)
    idempotency_key: str = Field(min_length=8, max_length=128)


class ReturnCreate(BaseModel):
    order_id: str


FailureMode = Literal["HTTP_429", "HTTP_500", "SERVICE_UNAVAILABLE", "TIMEOUT_BEFORE_ACCEPT", "TIMEOUT_AFTER_ACCEPT", "MALFORMED_RESPONSE", "MISSING_FIELD", "STALE_ORDER", "VALIDATION_ERROR", "PARTIAL_ERRORS", "REFUND_FAILED", "CONCURRENT_REFUND"]


def order_payload(row: sqlite3.Row) -> dict[str, Any]:
    data = dict(row)
    data["line_items"] = json.loads(data.pop("items"))
    data["remaining_refundable_minor"] = data["total_minor"] - data["refunded_minor"] - data["pending_minor"]
    return data


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "simulated-commerce"}


@app.get("/sim/v1/customers/{customer_id}")
def get_customer(customer_id: str) -> dict[str, str]:
    with connect() as db:
        row = db.execute("SELECT customer_id FROM orders WHERE customer_id=? LIMIT 1", (customer_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Customer not found")
    return {"id": customer_id}


@app.get("/sim/v1/orders")
def find_orders(customer_id: str | None = None, order_number: str | None = None) -> list[dict[str, Any]]:
    clauses: list[str] = []
    values: list[str] = []
    if customer_id:
        clauses.append("customer_id=?")
        values.append(customer_id)
    if order_number:
        clauses.append("number=?")
        values.append(order_number)
    query = "SELECT * FROM orders" + (" WHERE " + " AND ".join(clauses) if clauses else "")
    with connect() as db:
        return [order_payload(row) for row in db.execute(query, values)]


@app.get("/sim/v1/orders/{order_id}")
def get_order(order_id: str) -> dict[str, Any]:
    with connect() as db:
        row = db.execute("SELECT * FROM orders WHERE id=?", (order_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Order not found")
    return order_payload(row)


@app.get("/sim/v1/orders/{order_id}/refunds")
def get_refunds(order_id: str) -> list[dict[str, Any]]:
    with connect() as db:
        return [dict(row) for row in db.execute("SELECT * FROM refunds WHERE order_id=? ORDER BY created_at", (order_id,))]


@app.get("/sim/v1/orders/{order_id}/returns")
def get_returns(order_id: str) -> list[dict[str, Any]]:
    with connect() as db:
        return [dict(row) for row in db.execute("SELECT * FROM returns WHERE order_id=? ORDER BY created_at", (order_id,))]


@app.post("/sim/v1/returns", status_code=201)
def create_return(data: ReturnCreate) -> dict[str, str]:
    with connect() as db:
        if not db.execute("SELECT 1 FROM orders WHERE id=?", (data.order_id,)).fetchone():
            raise HTTPException(404, "Order not found")
        return_id = "ret_" + uuid.uuid4().hex[:12]
        db.execute("INSERT INTO returns VALUES(?,?,?,?)", (return_id, data.order_id, "REQUESTED", datetime.now(UTC).isoformat()))
    return {"id": return_id, "order_id": data.order_id, "status": "REQUESTED"}


@app.get("/sim/v1/refunds/by-key/{idempotency_key}")
def get_refund_by_key(idempotency_key: str) -> dict[str, Any]:
    with connect() as db:
        row = db.execute("SELECT * FROM refunds WHERE idempotency_key=?", (idempotency_key,)).fetchone()
    if not row:
        raise HTTPException(404, "Operation not found")
    return dict(row)


@app.get("/sim/v1/refunds/{refund_id}")
def get_refund(refund_id: str) -> dict[str, Any]:
    with connect() as db:
        row = db.execute("SELECT * FROM refunds WHERE id=?", (refund_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Refund not found")
    return dict(row)


@app.post("/sim/v1/refunds", status_code=202)
def create_refund(data: RefundCreate, failure_mode: FailureMode | None = Header(default=None, alias="X-Simulator-Failure")) -> Any:
    if failure_mode and not FAULTS_ENABLED:
        raise HTTPException(403, "Failure injection is disabled")
    if failure_mode == "HTTP_429":
        raise HTTPException(429, "Simulated rate limit")
    if failure_mode == "HTTP_500":
        raise HTTPException(500, "Simulated provider error")
    if failure_mode == "SERVICE_UNAVAILABLE":
        raise HTTPException(503, "Simulated temporary unavailability")
    if failure_mode == "VALIDATION_ERROR":
        raise HTTPException(422, "Simulated commerce validation error")
    if failure_mode == "TIMEOUT_BEFORE_ACCEPT":
        raise HTTPException(504, "Simulated timeout before operation acceptance")
    request_fingerprint = hashlib.sha256(f"{data.order_id}:{data.amount_minor}".encode()).hexdigest()
    with LOCK, connect() as db:
        previous = db.execute("SELECT * FROM refunds WHERE idempotency_key=?", (data.idempotency_key,)).fetchone()
        if previous:
            if previous["fingerprint"] != request_fingerprint:
                raise HTTPException(409, "Idempotency key reused with a different payload")
            return dict(previous)
        order = db.execute("SELECT * FROM orders WHERE id=?", (data.order_id,)).fetchone()
        if not order:
            raise HTTPException(404, "Order not found")
        balance = order["total_minor"] - order["refunded_minor"] - order["pending_minor"]
        if data.amount_minor > balance:
            raise HTTPException(409, "Refund exceeds remaining refundable balance")
        if failure_mode == "CONCURRENT_REFUND":
            raise HTTPException(409, "Concurrent order mutation detected")
        if failure_mode == "STALE_ORDER":
            db.execute("UPDATE orders SET version=version+1 WHERE id=?", (data.order_id,))
            db.commit()
            raise HTTPException(409, "Simulated stale order version")
        refund_id = "simrf_" + uuid.uuid4().hex[:12]
        status = "FAILED" if failure_mode == "REFUND_FAILED" else "PENDING"
        db.execute("INSERT INTO refunds VALUES(?,?,?,?,?,?,?)", (refund_id, data.idempotency_key, request_fingerprint, data.order_id, data.amount_minor, status, datetime.now(UTC).isoformat()))
        if status == "PENDING":
            db.execute("UPDATE orders SET pending_minor=pending_minor+?,version=version+1 WHERE id=?", (data.amount_minor, data.order_id))
        result = dict(db.execute("SELECT * FROM refunds WHERE id=?", (refund_id,)).fetchone())
    if failure_mode == "TIMEOUT_AFTER_ACCEPT":
        raise HTTPException(504, "Simulated lost response after operation acceptance")
    if failure_mode == "MALFORMED_RESPONSE":
        return Response(content="{malformed", status_code=202, media_type="application/json")
    if failure_mode == "MISSING_FIELD":
        result.pop("status", None)
    if failure_mode == "PARTIAL_ERRORS":
        result["errors"] = [{"message": "Simulated partial GraphQL-style error"}]
    return result


@app.post("/sim/v1/refunds/{refund_id}/settle")
def settle_refund(refund_id: str, fail: bool = False) -> dict[str, str]:
    with LOCK, connect() as db:
        refund = db.execute("SELECT * FROM refunds WHERE id=?", (refund_id,)).fetchone()
        if not refund or refund["status"] != "PENDING":
            raise HTTPException(409, "Refund is not pending")
        if fail:
            db.execute("UPDATE refunds SET status='FAILED' WHERE id=?", (refund_id,))
            db.execute("UPDATE orders SET pending_minor=pending_minor-?,version=version+1 WHERE id=?", (refund["amount_minor"], refund["order_id"]))
            return {"id": refund_id, "status": "FAILED"}
        db.execute("UPDATE refunds SET status='SETTLED' WHERE id=?", (refund_id,))
        db.execute("UPDATE orders SET pending_minor=pending_minor-?,refunded_minor=refunded_minor+?,version=version+1 WHERE id=?", (refund["amount_minor"], refund["amount_minor"], refund["order_id"]))
    return {"id": refund_id, "status": "SETTLED"}
