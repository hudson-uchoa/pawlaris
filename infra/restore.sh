#!/usr/bin/env bash
set -Eeuo pipefail

readonly APP_ROOT="/opt/pawlaris"
readonly INFRA_ROOT="${APP_ROOT}/infra"
readonly ENV_FILE="${APP_ROOT}/.env"
usage() { echo "Usage: restore.sh <archive> <age key file>" >&2; exit 2; }
[[ $# -eq 2 ]] || usage
archive="$1"
key_file="$2"
[[ -f "$archive" && -f "$key_file" ]] || { echo "Archive or key file is missing" >&2; exit 1; }

tmp_dir=""
finish() { local rc=$?; set +e; [[ -n "$tmp_dir" ]] && rm -rf -- "$tmp_dir"; exit "$rc"; }
trap finish EXIT
tmp_dir="$(mktemp -d /tmp/pawlaris-restore.XXXXXX)"
payload_tar="${tmp_dir}/payload.tar"
age -d -i "$key_file" -o "$payload_tar" "$archive"
tar -C "$tmp_dir" -xf "$payload_tar"
tar -C "$tmp_dir" -xf "${tmp_dir}/blobs.tar"

env_value() {
  local key="$1"
  awk -F= -v wanted="$key" '$1 == wanted { print substr($0, index($0, "=") + 1); exit }' "$ENV_FILE"
}
db_name="$(env_value POSTGRES_DB)"
db_user="$(env_value POSTGRES_USER)"
compose() { (cd "$INFRA_ROOT" && docker compose --env-file ../.env "$@"); }

compose stop api
compose up -d --wait postgres
compose exec -T postgres dropdb --if-exists --force -U "$db_user" "$db_name"
compose exec -T postgres createdb -U "$db_user" "$db_name"
cat "${tmp_dir}/db.dump" | compose exec -T postgres pg_restore --exit-on-error --no-owner -U "$db_user" -d "$db_name"
compose run --rm --no-deps -T --user root -v "${tmp_dir}/blobs:/restore/blobs:ro" api \
  sh -c 'rm -rf /data/blobs/* && cp -a /restore/blobs/. /data/blobs/ && chown -R pawlaris:pawlaris /data/blobs'
compose exec -T postgres psql -X -At -U "$db_user" -d "$db_name" \
  -c 'UPDATE server_meta SET sync_epoch = gen_random_uuid(); SELECT sync_epoch FROM server_meta;'
compose up -d api
echo "Restore completed; new sync_epoch follows:"
compose exec -T postgres psql -X -At -U "$db_user" -d "$db_name" -c 'SELECT sync_epoch FROM server_meta;'
