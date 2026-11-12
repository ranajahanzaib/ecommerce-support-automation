from fastapi.testclient import TestClient

import commerce_simulator.main as simulator


def client_for(tmp_path, monkeypatch):
    monkeypatch.setattr(simulator, "DB_PATH", tmp_path / "simulator.sqlite3")
    monkeypatch.setattr(simulator, "FAULTS_ENABLED", True)
    simulator.initialize()
    return TestClient(simulator.app)


def test_refund_idempotency_conflict_and_settlement(tmp_path, monkeypatch):
    client = client_for(tmp_path, monkeypatch)
    order = client.get("/sim/v1/orders/ord_1048").json()
    assert order["remaining_refundable_minor"] == 4500
    body = {"order_id":"ord_1048","amount_minor":2500,"idempotency_key":"sim-key-0001"}
    first = client.post("/sim/v1/refunds", json=body)
    replay = client.post("/sim/v1/refunds", json=body)
    assert first.status_code == 202
    assert first.json()["id"] == replay.json()["id"]
    conflict = client.post("/sim/v1/refunds", json={**body,"amount_minor":2400})
    assert conflict.status_code == 409
    pending = client.get("/sim/v1/orders/ord_1048").json()
    assert pending["refunded_minor"] == 0
    assert pending["pending_minor"] == 2500
    settled = client.post(f"/sim/v1/refunds/{first.json()['id']}/settle")
    assert settled.json()["status"] == "SETTLED"
    final = client.get("/sim/v1/orders/ord_1048").json()
    assert final["refunded_minor"] == 2500
    assert final["pending_minor"] == 0


def test_failure_after_acceptance_can_be_reconciled_by_key(tmp_path, monkeypatch):
    client = client_for(tmp_path, monkeypatch)
    body = {"order_id":"ord_1048","amount_minor":1200,"idempotency_key":"uncertain-key-1"}
    result = client.post("/sim/v1/refunds", json=body, headers={"X-Simulator-Failure":"TIMEOUT_AFTER_ACCEPT"})
    assert result.status_code == 504
    lookup = client.get("/sim/v1/refunds/by-key/uncertain-key-1")
    assert lookup.status_code == 200
    assert lookup.json()["status"] == "PENDING"


def test_http_provider_recovers_lost_acceptance_response(tmp_path, monkeypatch):
    import httpx
    from commerceaction.commerce import SimulatedCommerceProvider

    client = client_for(tmp_path, monkeypatch)
    def dispatch(method, url, **kwargs):
        kwargs.pop("timeout", None)
        return client.request(method, url.replace("http://simulator.test", ""), **kwargs)

    monkeypatch.setattr(httpx, "request", dispatch)
    provider = SimulatedCommerceProvider(
        "http://simulator.test",
        failure_mode="TIMEOUT_AFTER_ACCEPT",
    )
    result = provider.create_refund("ord_1048", 1000, "adapter-unknown-key")
    assert result["status"] == "PENDING"
    assert provider.get_order("ord_1048")["pending_minor"] == 1000
