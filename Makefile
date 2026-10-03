# Pawlaris — thin delegator to the Node harness runner.
#
# The canonical entry point is `pnpm verify` (scripts/verify.mjs), NOT make.
# See ADR-014: the Windows dev machine has no `make`. This file exists so
# Linux/CI and muscle memory keep working.

.PHONY: verify verify-task lint typecheck test vectors contract-check \
        contract-freeze types security doctor help

verify:            ; pnpm verify
verify-task:       ; pnpm verify --allow-pending
lint:              ; pnpm lint
typecheck:         ; pnpm typecheck
test:              ; pnpm test
vectors:           ; pnpm vectors
contract-check:    ; pnpm contract-check
contract-freeze:   ; pnpm contract-freeze
types:             ; pnpm types
security:          ; pnpm security
doctor:            ; node scripts/doctor.mjs

help:
	@echo "Pawlaris — canonical runner is 'pnpm verify'"
	@echo ""
	@echo "  verify          every gate, strict (the release bar)"
	@echo "  verify-task     every gate, PENDING tolerated (the task bar)"
	@echo "  lint typecheck test security             one group"
	@echo "  pnpm verify --only <id>                  one gate"
	@echo "  pnpm verify --list                       list gates"
	@echo ""
	@echo "See spec/07-test-harness.md."
