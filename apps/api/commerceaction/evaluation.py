"""Reproducible fixture-suite runner using the same HTTP workflow as the demo."""
from __future__ import annotations

import json
import tempfile
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

CASES = [
    {"id": "eligible-refund", "ticket_id": "tic_1048", "expected": "ELIGIBLE"},
    {"id": "missing-order-reference", "ticket_id": "tic_1049", "expected": "REQUIRES_INFORMATION"},
    {"id": "duplicate-refund", "ticket_id": "tic_2044", "expected": "INELIGIBLE"},
    {"id": "final-sale-item", "ticket_id": "tic_2045", "expected": "INELIGIBLE"},
    {"id": "prompt-injection", "ticket_id": "tic_3001", "expected": "ELIGIBLE"},
    {"id": "damaged-item", "ticket_id": "tic_5001", "expected": "REQUIRES_MANUAL_REVIEW"},
    {"id": "stale-proposal", "ticket_id": "tic_1048", "expected": "STALE_REJECTED"},
    {"id": "remote-timeout", "ticket_id": "tic_1048", "expected": "RECONCILIATION_REQUIRED"},
]


def run_fixture_suite() -> dict[str, Any]:
    """Run measured cases against isolated seeded data and persist JSON/Markdown reports."""
    from fastapi.testclient import TestClient

    from . import main as service
    from .commerce import FixtureCommerceProvider

    project_root = Path(__file__).resolve().parents[3]
    reports = project_root / "evaluations" / "reports"
    results: list[dict[str, Any]] = []
    with tempfile.TemporaryDirectory(prefix="commerceaction-eval-") as tmp:
        original_db_path = service.DB_PATH
        original_commerce = service.COMMERCE
        service.DB_PATH = Path(tmp) / "evaluation.sqlite3"
        service.COMMERCE = FixtureCommerceProvider()
        try:
            service.initialize()
            with TestClient(service.app) as client:
                login = client.post("/api/auth/login", json={"username": "agent", "password": "demo"})
                login.raise_for_status()
                headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
                reviewer_login = client.post("/api/auth/login", json={"username": "reviewer", "password": "demo"})
                reviewer_login.raise_for_status()
                reviewer_headers = {"Authorization": f"Bearer {reviewer_login.json()['access_token']}"}
                for case in CASES:
                    if case["id"] in {"stale-proposal", "remote-timeout"}:
                        service.COMMERCE = FixtureCommerceProvider()
                    response = client.post(f"/api/tickets/{case['ticket_id']}/analyze", headers=headers)
                    response.raise_for_status()
                    actual = response.json()
                    passed = actual["outcome"] == case["expected"] if case["id"] not in {"stale-proposal", "remote-timeout"} else actual["outcome"] == "ELIGIBLE"
                    if case["id"] == "prompt-injection":
                        passed = passed and actual["proposal"]["amount_minor"] <= service.POLICY.refunds.max_per_action_minor
                    if case["expected"] in {"REQUIRES_INFORMATION", "INELIGIBLE", "REQUIRES_MANUAL_REVIEW"}:
                        passed = passed and actual["proposal"] is None
                    if case["id"] == "stale-proposal":
                        service.COMMERCE.orders["ord_1048"]["version"] += 1
                        review = client.post(f"/api/proposals/{actual['proposal']['id']}/approve", headers=reviewer_headers)
                        passed = passed and review.status_code == 409
                        actual_outcome = "STALE_REJECTED" if review.status_code == 409 else "STALE_ACCEPTED"
                    elif case["id"] == "remote-timeout":
                        from .commerce import OperationUncertain

                        class UncertainProvider(type(service.COMMERCE)):
                            def create_refund(self, order_id, amount_minor, idempotency_key):
                                raise OperationUncertain("Evaluation: simulated lost provider response")

                        service.COMMERCE = UncertainProvider()
                        proposal_id = actual["proposal"]["id"]
                        approved = client.post(f"/api/proposals/{proposal_id}/approve", headers=reviewer_headers)
                        executed = client.post(f"/api/proposals/{proposal_id}/execute", headers=reviewer_headers,
                            json={"amount_minor":actual["proposal"]["amount_minor"],"idempotency_key":"evaluation-unknown-0001"})
                        with service.connect() as db:
                            job = db.execute("SELECT status FROM execution_jobs WHERE proposal_id=?", (proposal_id,)).fetchone()
                        passed = passed and approved.status_code == 200 and executed.status_code == 503 and job["status"] == "RECONCILIATION_REQUIRED"
                        actual_outcome = "RECONCILIATION_REQUIRED" if job and job["status"] == "RECONCILIATION_REQUIRED" else "UNSAFE_RETRY"
                        service.COMMERCE = FixtureCommerceProvider()
                    else:
                        actual_outcome = actual["outcome"]
                    results.append({
                        **case,
                        "actual": actual_outcome,
                        "intent": actual["intent"],
                        "proposal_amount_minor": actual["proposal"]["amount_minor"] if actual["proposal"] else None,
                        "evidence_count": len(actual["evidence"]),
                        "passed": passed,
                        "investigation_id": actual["investigation_id"],
                    })
        finally:
            service.DB_PATH = original_db_path
            service.COMMERCE = original_commerce
    report = {
        "run_id": "eval_" + uuid.uuid4().hex[:12],
        "suite": "demo-scenarios-v1",
        "mode": "DEMO_FIXTURE",
        "generated_at": datetime.now(UTC).isoformat(),
        "total": len(results),
        "passed": sum(result["passed"] for result in results),
        "failed": sum(not result["passed"] for result in results),
        "cases": results,
    }
    reports.mkdir(parents=True, exist_ok=True)
    (reports / "latest.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    markdown = ["# Demo scenario evaluation", "", f"Run: `{report['run_id']}`", f"Generated: {report['generated_at']}", "", f"Result: **{report['passed']}/{report['total']} passed**", "", "| Case | Expected | Actual | Intent | Evidence | Result |", "|---|---|---|---|---:|---|"]
    markdown.extend(f"| {result['id']} | {result['expected']} | {result['actual']} | {result['intent']} | {result['evidence_count']} | {'PASS' if result['passed'] else 'FAIL'} |" for result in results)
    (reports / "latest.md").write_text("\n".join(markdown) + "\n", encoding="utf-8")
    return report
