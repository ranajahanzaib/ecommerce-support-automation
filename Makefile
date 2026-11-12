.PHONY: dev api simulator web install seed reset test eval
install:
	cd apps/api && python3 -m venv .venv && .venv/bin/python -m pip install -e '.[dev]' -e '../commerce-simulator[dev]'
	cd apps/web && pnpm install --frozen-lockfile
api:
	cd apps/api && .venv/bin/uvicorn commerceaction.main:app --reload --host 127.0.0.1 --port 8000
simulator:
	cd apps/commerce-simulator && SIMULATOR_FAULTS_ENABLED=true ../../apps/api/.venv/bin/uvicorn commerce_simulator.main:app --reload --host 127.0.0.1 --port 8001
web:
	cd apps/web && pnpm dev
dev:
	@$(MAKE) api & api_pid=$$!; $(MAKE) simulator & simulator_pid=$$!; $(MAKE) web & web_pid=$$!; trap 'kill $$api_pid $$simulator_pid $$web_pid 2>/dev/null || true' INT TERM EXIT; wait $$api_pid $$simulator_pid $$web_pid
seed:
	cd apps/api && .venv/bin/python -c 'from commerceaction.main import initialize; initialize()'
	cd apps/commerce-simulator && PYTHONPATH=. ../../apps/api/.venv/bin/python -c 'from commerce_simulator.main import initialize; initialize()'
reset:
	rm -f apps/api/commerceaction.db apps/commerce-simulator/simulator.db commerceaction.db
	$(MAKE) seed
test:
	cd apps/api && .venv/bin/pytest && .venv/bin/ruff check commerceaction tests
	cd apps/commerce-simulator && PYTHONPATH=. ../../apps/api/.venv/bin/pytest && ../../apps/api/.venv/bin/ruff check commerce_simulator tests
	cd apps/web && pnpm typecheck && pnpm build
eval:
	cd apps/api && PYTHONPATH=. .venv/bin/python ../../scripts/evaluate.py
