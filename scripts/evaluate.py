"""CLI entry point for the deterministic fixture evaluation suite."""
from commerceaction.evaluation import run_fixture_suite

report = run_fixture_suite()
print(f"Evaluation result: {report['passed']}/{report['total']} passed")
for result in report["cases"]:
    print(f"{'PASS' if result['passed'] else 'FAIL'} {result['id']}: {result['actual']} / {result['intent']}")
if report["failed"]:
    raise SystemExit(1)
