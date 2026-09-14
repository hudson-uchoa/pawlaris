# Pawlaris — thin delegator to the Node harness runner.
#
# The canonical entry point is `pnpm verify` (scripts/verify.mjs), NOT make.
# See ADR-014: the Windows dev machine has no `make`, and requiring one more
# global install to run the gates would put friction in front of the one command
# that decides whether work is done. Node is already a hard dependency.
#
# This file exists so Linux/CI and muscle memory keep working.

.PHONY: verify lint typecheck test parity contract-check security help \
        contract-freeze types api-up api-down deploy

verify:            ; pnpm verify
lint:              ; pnpm lint
typecheck:         ; pnpm typecheck
test:              ; pnpm test
parity:            ; pnpm parity
contract-check:    ; pnpm contract-check
security:          ; pnpm security

# --- implemented by later tasks; fail loudly until then ---------------------
contract-freeze:   ; @echo "not implemented — task P1-5 (spec/08-tasks.md)"; exit 1
types:             ; @echo "not implemented — task P1-5 (spec/08-tasks.md)"; exit 1
api-up:            ; @echo "not implemented — task P0-4 (spec/08-tasks.md)"; exit 1
api-down:          ; @echo "not implemented — task P0-4 (spec/08-tasks.md)"; exit 1
deploy:            ; @echo "not implemented — task P8-4 (spec/08-tasks.md)"; exit 1

help:
	@echo "Pawlaris — canonical runner is 'pnpm verify'"
	@echo ""
	@echo "  verify          every gate (the definition of done)"
	@echo "  lint typecheck test parity security      one group"
	@echo "  pnpm verify --only <id>                  one gate"
	@echo "  pnpm verify --list                       list gates"
	@echo ""
	@echo "Not green = not done. See spec/07-test-harness.md."
