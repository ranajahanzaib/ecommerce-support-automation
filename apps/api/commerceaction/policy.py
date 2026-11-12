"""Validated policy configuration and deterministic return/refund eligibility."""
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field

Outcome = Literal["ELIGIBLE", "INELIGIBLE", "REQUIRES_INFORMATION", "REQUIRES_MANUAL_REVIEW", "BLOCKED"]
POLICY_PATH = Path(__file__).resolve().parents[3] / "policies" / "demo-store" / "returns-v1.yaml"


class ReturnPolicy(BaseModel):
    window_days: int = Field(gt=0, le=365)
    window_start: Literal["delivered_at"]
    require_return_received_before_refund: bool


class RefundPolicy(BaseModel):
    allow_partial: bool
    allow_full: bool
    refund_shipping: bool
    require_human_approval: bool
    max_per_action_minor: int = Field(gt=0)


class PolicyConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    policy_id: str
    version: int = Field(gt=0)
    timezone: str
    returns: ReturnPolicy
    refunds: RefundPolicy
    exclusions: dict[str, bool]
    exceptions: dict[str, str]


def load_policy(path: Path = POLICY_PATH) -> PolicyConfig:
    """Load and validate the versioned merchant policy; invalid policy fails closed."""
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    return PolicyConfig.model_validate(raw)


@dataclass(frozen=True)
class EligibilityResult:
    outcome: Outcome
    eligible_amount_minor: int
    applied_rules: tuple[str, ...]
    warnings: tuple[str, ...] = ()


def evaluate_refund(*, customer_verified: bool, owns_order: bool, delivered_at: date | None,
                    today: date, window_days: int, remaining_minor: int,
                    has_final_sale_item: bool) -> EligibilityResult:
    """Prove policy eligibility using trusted records and integer minor units."""
    if not customer_verified or not owns_order:
        return EligibilityResult("BLOCKED", 0, ("IDENTITY_MISMATCH",))
    if delivered_at is None:
        return EligibilityResult("REQUIRES_MANUAL_REVIEW", 0, ("DELIVERY_DATE_MISSING",))
    if delivered_at > today:
        return EligibilityResult("REQUIRES_MANUAL_REVIEW", 0, ("DELIVERY_DATE_CONFLICT",))
    if has_final_sale_item:
        return EligibilityResult("INELIGIBLE", 0, ("FINAL_SALE_EXCLUSION",))
    age_days = (today - delivered_at).days
    if age_days > window_days:
        return EligibilityResult("INELIGIBLE", 0, ("RETURN_WINDOW_EXPIRED",))
    if remaining_minor <= 0:
        return EligibilityResult("INELIGIBLE", 0, ("NO_REFUNDABLE_BALANCE",))
    return EligibilityResult("ELIGIBLE", remaining_minor, ("VERIFIED_OWNERSHIP", "RETURN_WITHIN_WINDOW", "REFUNDABLE_BALANCE_AVAILABLE"))
