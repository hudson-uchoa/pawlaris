#!/usr/bin/env bash
set -Eeuo pipefail

readonly APP_ROOT="/opt/pawlaris"
readonly ENV_FILE="${APP_ROOT}/.env"
readonly INFRA_ROOT="${APP_ROOT}/infra"
readonly BACKUP_ROOT="${APP_ROOT}/backups"
readonly SCRIPT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "bootstrap.sh must run as root" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

install_packages() {
  apt-get update
  apt-get install -y age ca-certificates curl gnupg lsb-release util-linux
}

configure_swap() {
  if [[ ! -e /swapfile ]]; then
    fallocate -l 2G /swapfile
  fi
  chmod 600 /swapfile
  if ! swapon --show=NAME --noheadings | grep -Fxq /swapfile; then
    mkswap /swapfile >/dev/null
    swapon /swapfile
  fi
  if ! grep -Fqx '/swapfile none swap sw 0 0' /etc/fstab; then
    printf '%s\n' '/swapfile none swap sw 0 0' >> /etc/fstab
  fi
  sysctl -w vm.swappiness=10 >/dev/null
  printf '%s\n' 'vm.swappiness=10' > /etc/sysctl.d/99-swap.conf
}

install_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    curl -fsSL https://get.docker.com | sh
  fi
  systemctl enable --now docker
}

create_layout() {
  install -d -m 755 "$APP_ROOT" "$INFRA_ROOT" "$BACKUP_ROOT"
  for infra_file in docker-compose.yml postgresql.conf; do
    if [[ -f "${SCRIPT_ROOT}/${infra_file}" ]]; then
      install -m 644 "${SCRIPT_ROOT}/${infra_file}" "${INFRA_ROOT}/${infra_file}"
    fi
  done
  if [[ ! -e "$ENV_FILE" ]]; then
    umask 077
    cat > "$ENV_FILE" <<'EOF'
# Replace every placeholder before starting the stack.
POSTGRES_DB=pawlaris
POSTGRES_USER=pawlaris
POSTGRES_PASSWORD=REPLACE_WITH_A_RANDOM_DATABASE_PASSWORD
DATABASE_URL=postgresql+asyncpg://pawlaris:REPLACE_WITH_A_RANDOM_DATABASE_PASSWORD@postgres:5432/pawlaris
JWT_SECRET=REPLACE_WITH_AT_LEAST_32_RANDOM_BYTES
PUSH_ENABLED=true
SERVER_ROLE=primary
APP_VERSION=stable
LOG_LEVEL=INFO
EOF
  fi
  chmod 600 "$ENV_FILE"
}

check_ssh_hardening() {
  if ! command -v sshd >/dev/null 2>&1 || ! sshd -T 2>/dev/null | grep -Fxq 'passwordauthentication no'; then
    echo "SSH hardening check failed: PasswordAuthentication no is required" >&2
    exit 1
  fi
}

login_ghcr_if_requested() {
  if [[ -n "${GHCR_READ_TOKEN:-}" ]]; then
    if [[ -z "${GHCR_USERNAME:-}" ]]; then
      echo "GHCR_USERNAME is required when GHCR_READ_TOKEN is provided" >&2
      exit 1
    fi
    printf '%s' "$GHCR_READ_TOKEN" | docker login ghcr.io --username "$GHCR_USERNAME" --password-stdin
  fi
}

install_packages
configure_swap
install_docker
create_layout
check_ssh_hardening
login_ghcr_if_requested

echo "Pawlaris bootstrap complete. Review ${ENV_FILE} before starting the stack."
