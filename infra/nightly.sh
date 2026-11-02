#!/usr/bin/env bash
set -Eeuo pipefail

readonly APP_ROOT="/opt/pawlaris"
readonly INFRA_ROOT="${APP_ROOT}/infra"

"${INFRA_ROOT}/backup.sh"
(cd "$INFRA_ROOT" && docker compose --env-file ../.env run --rm api python -m app.cli maintenance)
