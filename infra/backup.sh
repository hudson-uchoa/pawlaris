#!/usr/bin/env bash
set -Eeuo pipefail

readonly APP_ROOT="/opt/pawlaris"
readonly INFRA_ROOT="${APP_ROOT}/infra"
readonly ENV_FILE="${APP_ROOT}/.env"
readonly BACKUP_ROOT="${APP_ROOT}/backups"
readonly VERIFY_DB="pawlaris_verify"
readonly TABLES=(family app_user pet weight_entry health_event task_template task_completion task_timer walk_session asset)

tmp_dir=""
published_archive=""
verify_exists=false
failure_recorded=false
db_user=""

env_value() {
  local key="$1"
  awk -F= -v wanted="$key" '$1 == wanted { print substr($0, index($0, "=") + 1); exit }' "$ENV_FILE"
}

compose() {
  (cd "$INFRA_ROOT" && docker compose --env-file ../.env "$@")
}

drop_verify() {
  if [[ "$verify_exists" == true ]]; then
    compose exec -T postgres dropdb --if-exists --force -U "$db_user" "$VERIFY_DB" >/dev/null 2>&1 || true
    verify_exists=false
  fi
}

write_failed_status() {
  if [[ "$failure_recorded" == false ]]; then
    failure_recorded=true
    printf '{"finished_at":"%s","status":"failed","verified":false}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "${BACKUP_ROOT}/last_backup.json"
  fi
}

finish() {
  local rc=$?
  set +e
  drop_verify
  if (( rc != 0 )); then
    write_failed_status
    if [[ -n "$published_archive" ]]; then
      rm -f -- "$published_archive" "${published_archive}.sha256"
    fi
  fi
  if [[ -n "$tmp_dir" ]]; then
    rm -rf -- "$tmp_dir"
  fi
  exit "$rc"
}
trap finish EXIT

[[ -f "$ENV_FILE" ]] || { echo "Missing ${ENV_FILE}" >&2; exit 1; }
recipient="$(env_value BACKUP_AGE_RECIPIENT)"
[[ -n "$recipient" && "$recipient" != REPLACE_* ]] || {
  echo "BACKUP_AGE_RECIPIENT is not configured" >&2
  exit 1
}
mkdir -p -- "$BACKUP_ROOT"
tmp_dir="$(mktemp -d "${BACKUP_ROOT}/.tmp.XXXXXX")"
dump_file="${tmp_dir}/db.dump"
blobs_tar="${tmp_dir}/blobs.tar"
payload_tar="${tmp_dir}/payload.tar"
encrypted_file="${tmp_dir}/backup.tar.age"
checksum_file="${tmp_dir}/backup.tar.age.sha256"
archive_date="$(date -u +%Y-%m-%d)"
archive_path="${BACKUP_ROOT}/${archive_date}.tar.age"

db_name="$(env_value POSTGRES_DB)"
db_user="$(env_value POSTGRES_USER)"
[[ -n "$db_name" && -n "$db_user" ]] || { echo "Database settings are missing" >&2; exit 1; }

compose exec -T postgres pg_dump -Fc -U "$db_user" -d "$db_name" > "$dump_file"

count_tables() {
  local database="$1"
  local table
  for table in "${TABLES[@]}"; do
    compose exec -T postgres psql -X -At -U "$db_user" -d "$database" \
      -c "SELECT count(*) FROM ${table};"
  done
}

before_file="${tmp_dir}/before.counts"
restored_file="${tmp_dir}/restored.counts"
after_file="${tmp_dir}/after.counts"
count_tables "$db_name" > "$before_file"
compose exec -T postgres dropdb --if-exists --force -U "$db_user" "$VERIFY_DB" >/dev/null 2>&1 || true
compose exec -T postgres createdb -U "$db_user" "$VERIFY_DB"
verify_exists=true
cat "$dump_file" | compose exec -T postgres pg_restore --exit-on-error --no-owner -U "$db_user" -d "$VERIFY_DB"
count_tables "$VERIFY_DB" > "$restored_file"
count_tables "$db_name" > "$after_file"
paste "$before_file" "$restored_file" "$after_file" | awk '{ if ($1 > $2 || $2 > $3) exit 1 }'
drop_verify

compose run --rm --no-deps -T api \
  sh -c 'tar -C /data -cf - blobs' > "$blobs_tar"
tar -C "$tmp_dir" -cf "$payload_tar" db.dump blobs.tar
age -r "$recipient" -o "$encrypted_file" "$payload_tar"
sha256sum "$encrypted_file" > "$checksum_file"
published_archive="$archive_path"
mv -- "$encrypted_file" "$archive_path"
mv -- "$checksum_file" "${archive_path}.sha256"

find "$BACKUP_ROOT" -maxdepth 1 -type f -name '*.tar.age' -printf '%T@ %p\n' \
  | sort -nr | tail -n +15 | cut -d' ' -f2- | while IFS= read -r old; do
      rm -f -- "$old" "${old}.sha256"
    done
printf '{"finished_at":"%s","bytes":%s,"verified":true}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(stat -c '%s' "$archive_path")" \
  > "${BACKUP_ROOT}/last_backup.json"
echo "Backup verified: ${archive_path}"
