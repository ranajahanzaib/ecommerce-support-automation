"""CommerceProvider adapter contract and HTTP implementation for the separate simulator."""
from __future__ import annotations

import uuid
from typing import Any, Protocol
from urllib.parse import quote

import httpx


class CommerceProviderError(RuntimeError):
    """A known provider error that did not create an unverified operation."""


class OperationUncertain(CommerceProviderError):
    """The provider response was ambiguous and idempotency lookup found no result."""


class CommerceProvider(Protocol):
    def get_customer(self, customer_id: str) -> dict[str, Any]: ...
    def find_orders(self, customer_id: str | None = None, order_number: str | None = None) -> list[dict[str, Any]]: ...
    def get_order(self, order_id: str) -> dict[str, Any]: ...
    def get_refunds(self, order_id: str) -> list[dict[str, Any]]: ...
    def get_returns(self, order_id: str) -> list[dict[str, Any]]: ...
    def calculate_refund(self, order_id: str, amount_minor: int) -> dict[str, Any]: ...
    def create_return_request(self, order_id: str) -> dict[str, Any]: ...
    def create_refund(self, order_id: str, amount_minor: int, idempotency_key: str) -> dict[str, Any]: ...
    def get_operation_status(self, refund_id: str) -> dict[str, Any]: ...
    def find_operation_by_idempotency_key(self, key: str) -> dict[str, Any] | None: ...
    def settle_refund(self, refund_id: str, fail: bool = False) -> dict[str, Any]: ...


class SimulatedCommerceProvider:
    """HTTP adapter for the isolated ecommerce-support-automation simulator service."""

    def __init__(self, base_url: str, *, timeout: float = 5.0, failure_mode: str | None = None):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.failure_mode = failure_mode

    def _request(self, method: str, path: str, **kwargs: Any) -> dict[str, Any] | list[dict[str, Any]]:
        headers = dict(kwargs.pop("headers", {}))
        if self.failure_mode:
            headers["X-Simulator-Failure"] = self.failure_mode
        try:
            response = httpx.request(method, self.base_url + path, timeout=self.timeout, headers=headers, **kwargs)
            response.raise_for_status()
            payload = response.json()
        except httpx.HTTPStatusError as exc:
            raise CommerceProviderError(f"Simulator returned HTTP {exc.response.status_code}") from exc
        except (httpx.TimeoutException, httpx.NetworkError) as exc:
            raise OperationUncertain("Simulator outcome could not be confirmed") from exc
        except (ValueError, KeyError) as exc:
            raise OperationUncertain("Simulator returned malformed data") from exc
        return payload

    def get_customer(self, customer_id: str) -> dict[str, Any]:
        return self._request("GET", f"/sim/v1/customers/{customer_id}")  # type: ignore[return-value]

    def find_orders(self, customer_id: str | None = None, order_number: str | None = None) -> list[dict[str, Any]]:
        params = {key: value for key, value in {"customer_id": customer_id, "order_number": order_number}.items() if value}
        return self._request("GET", "/sim/v1/orders", params=params)  # type: ignore[return-value]

    def get_order(self, order_id: str) -> dict[str, Any]:
        return self._request("GET", f"/sim/v1/orders/{order_id}")  # type: ignore[return-value]

    def get_refunds(self, order_id: str) -> list[dict[str, Any]]:
        return self._request("GET", f"/sim/v1/orders/{order_id}/refunds")  # type: ignore[return-value]

    def get_returns(self, order_id: str) -> list[dict[str, Any]]:
        return self._request("GET", f"/sim/v1/orders/{order_id}/returns")  # type: ignore[return-value]

    def calculate_refund(self, order_id: str, amount_minor: int) -> dict[str, Any]:
        order = self.get_order(order_id)
        return {"currency": order["currency"], "requested_minor": amount_minor, "remaining_minor": order["remaining_refundable_minor"], "eligible": 0 < amount_minor <= order["remaining_refundable_minor"]}

    def create_return_request(self, order_id: str) -> dict[str, Any]:
        return self._request("POST", "/sim/v1/returns", json={"order_id": order_id})  # type: ignore[return-value]

    def find_operation_by_idempotency_key(self, key: str) -> dict[str, Any] | None:
        try:
            return self._request("GET", f"/sim/v1/refunds/by-key/{quote(key, safe='')}")  # type: ignore[return-value]
        except CommerceProviderError as exc:
            if "HTTP 404" in str(exc):
                return None
            raise

    def create_refund(self, order_id: str, amount_minor: int, idempotency_key: str) -> dict[str, Any]:
        try:
            payload = self._request("POST", "/sim/v1/refunds", json={"order_id": order_id, "amount_minor": amount_minor, "idempotency_key": idempotency_key})
            if not isinstance(payload, dict) or not payload.get("id") or not payload.get("status"):
                raise OperationUncertain("Simulator response omitted required refund fields")
            if payload.get("errors"):
                raise CommerceProviderError("Simulator reported partial application errors")
            return payload
        except (CommerceProviderError, OperationUncertain):
            existing = self.find_operation_by_idempotency_key(idempotency_key)
            if existing:
                if existing["order_id"] != order_id or existing["amount_minor"] != amount_minor:
                    raise CommerceProviderError("Idempotency key conflicts with existing operation")
                return existing
            raise

    def get_operation_status(self, refund_id: str) -> dict[str, Any]:
        return self._request("GET", f"/sim/v1/refunds/{refund_id}")  # type: ignore[return-value]

    def settle_refund(self, refund_id: str, fail: bool = False) -> dict[str, Any]:
        return self._request("POST", f"/sim/v1/refunds/{refund_id}/settle", params={"fail": str(fail).lower()})  # type: ignore[return-value]


class FixtureCommerceProvider:
    """In-memory provider used only by offline tests and fixture evaluations."""

    def __init__(self) -> None:
        from datetime import date, timedelta

        current = date.today()
        standard = [{"title":"Everyday Tote","sku":"TOTE-01","quantity":1,"unit_price_minor":4500,"final_sale":False}]
        pouch = [{"title":"Canvas Pouch","sku":"POUCH-02","quantity":1,"unit_price_minor":2100,"final_sale":False}]
        final_sale = [{"title":"Clearance Mug","sku":"MUG-FINAL","quantity":1,"unit_price_minor":1800,"final_sale":True}]
        definitions = [
            ("ord_1048","cus_100","1048",4500,0,12,standard),
            ("ord_1049","cus_100","1049",2100,0,6,pouch),
            ("ord_2044","cus_200","2044",8900,8900,45,standard),
            ("ord_2045","cus_200","2045",1800,0,4,final_sale),
            ("ord_3001","cus_300","3001",12000,0,8,standard),
        ]
        self.orders = {record[0]: {"id":record[0],"customer_id":record[1],"number":record[2],"currency":"USD","total_minor":record[3],"refunded_minor":record[4],"pending_minor":0,"delivered_at":(current-timedelta(days=record[5])).isoformat(),"version":2 if record[0]=="ord_2044" else 1,"line_items":record[6]} for record in definitions}
        self.refunds: dict[str, dict[str, Any]] = {}
        self.keys: dict[str, str] = {}
        self.returns: dict[str, dict[str, Any]] = {}

    def get_customer(self, customer_id: str) -> dict[str, Any]:
        if not any(order["customer_id"] == customer_id for order in self.orders.values()):
            raise CommerceProviderError("Customer not found")
        return {"id":customer_id}

    def find_orders(self, customer_id: str | None = None, order_number: str | None = None) -> list[dict[str, Any]]:
        return [order.copy() for order in self.orders.values() if (not customer_id or order["customer_id"]==customer_id) and (not order_number or order["number"]==order_number)]

    def get_order(self, order_id: str) -> dict[str, Any]:
        if order_id not in self.orders:
            raise CommerceProviderError("Order not found")
        order=self.orders[order_id].copy()
        order["remaining_refundable_minor"]=order["total_minor"]-order["refunded_minor"]-order["pending_minor"]
        return order

    def get_refunds(self, order_id: str) -> list[dict[str, Any]]:
        return [refund.copy() for refund in self.refunds.values() if refund["order_id"]==order_id]

    def get_returns(self, order_id: str) -> list[dict[str, Any]]:
        return [item.copy() for item in self.returns.values() if item["order_id"]==order_id]

    def calculate_refund(self, order_id: str, amount_minor: int) -> dict[str, Any]:
        order=self.get_order(order_id)
        return {"currency":order["currency"],"requested_minor":amount_minor,"remaining_minor":order["remaining_refundable_minor"],"eligible":0<amount_minor<=order["remaining_refundable_minor"]}

    def create_return_request(self, order_id: str) -> dict[str, Any]:
        result={"id":"ret_"+uuid.uuid4().hex[:12],"order_id":order_id,"status":"REQUESTED"}
        self.returns[result["id"]]=result
        return result

    def find_operation_by_idempotency_key(self, key: str) -> dict[str, Any] | None:
        refund_id=self.keys.get(key)
        return self.refunds.get(refund_id).copy() if refund_id else None

    def create_refund(self, order_id: str, amount_minor: int, idempotency_key: str) -> dict[str, Any]:
        previous=self.find_operation_by_idempotency_key(idempotency_key)
        if previous:
            if previous["order_id"] != order_id or previous["amount_minor"] != amount_minor:
                raise CommerceProviderError("Idempotency key conflict")
            return previous
        order=self.get_order(order_id)
        if amount_minor>order["remaining_refundable_minor"]:
            raise CommerceProviderError("Over-refund blocked")
        result={"id":"simrf_"+uuid.uuid4().hex[:12],"idempotency_key":idempotency_key,"order_id":order_id,"amount_minor":amount_minor,"status":"PENDING"}
        self.refunds[result["id"]]=result
        self.keys[idempotency_key]=result["id"]
        self.orders[order_id]["pending_minor"]+=amount_minor
        self.orders[order_id]["version"]+=1
        return result.copy()

    def get_operation_status(self, refund_id: str) -> dict[str, Any]:
        if refund_id not in self.refunds:
            raise CommerceProviderError("Operation not found")
        return self.refunds[refund_id].copy()

    def settle_refund(self, refund_id: str, fail: bool = False) -> dict[str, Any]:
        refund=self.get_operation_status(refund_id)
        if refund["status"] != "PENDING":
            raise CommerceProviderError("Refund is not pending")
        amount=refund["amount_minor"]
        order=self.orders[refund["order_id"]]
        order["pending_minor"]-=amount
        order["version"]+=1
        refund["status"]="FAILED" if fail else "SETTLED"
        if not fail:
            order["refunded_minor"]+=amount
        self.refunds[refund_id]=refund
        return {"id":refund_id,"status":refund["status"]}
