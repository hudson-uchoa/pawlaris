#!/usr/bin/env bash
set -Eeuo pipefail

readonly APP_ROOT="/opt/pawlaris"
readonly INFRA_ROOT="${APP_ROOT}/infra"
readonly ENV_FILE="${APP_ROOT}/.env"
readonly IMAGE_REPOSITORY="ghcr.io/hudson-uchoa/pawlaris-api"
readonly DEFAULT_HEALTH_URL="http://localhost:8000/api/v1/health"

usage() {
  echo "Usage: deploy.sh <tag>" >&2
  exit 2
}

[[ $# -eq 1 ]] || usage
tag="$1"
if [[ ! "$tag" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]]; then
  echo "Invalid image tag" >&2
  exit 2
fi
[[ -f "$ENV_FILE" ]] || { echo "Missing ${ENV_FILE}" >&2; exit 1; }

previous_tag="$(awk -F= '$1 == "APP_VERSION" { print substr($0, index($0, "=") + 1); exit }' "$ENV_FILE")"
if [[ -z "$previous_tag" || ! "$previous_tag" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]]; then
  echo "Invalid recorded APP_VERSION" >&2
  exit 1
fi

set_version() {
  local version="$1"
  if grep -q '^APP_VERSION=' "$ENV_FILE"; then
    sed -i "s/^APP_VERSION=.*/APP_VERSION=${version}/" "$ENV_FILE"
  else
    printf '\nAPP_VERSION=%s\n' "$version" >> "$ENV_FILE"
  fi
}

compose() {
  (cd "$INFRA_ROOT" && docker compose --env-file ../.env "$@")
}

rollback() {
  set_version "$previous_tag"
  compose up -d
}

set_version "$tag"
if ! compose pull; then
  set_version "$previous_tag"
  exit 1
fi
if ! compose run --rm api alembic upgrade head; then
  set_version "$previous_tag"
  exit 1
fi
if ! compose up -d; then
  rollback
  exit 1
fi

health_url="${HEALTH_URL:-$DEFAULT_HEALTH_URL}"
healthy=false
for _ in $(seq 1 60); do
  if curl --fail --silent --show-error --max-time 3 "$health_url" >/dev/null; then
    healthy=true
    break
  fi
  sleep 1
done

if [[ "$healthy" != true ]]; then
  echo "Health check failed; rolling back" >&2
  rollback
  exit 1
fi

echo "Deployed ${IMAGE_REPOSITORY}:${tag}"
