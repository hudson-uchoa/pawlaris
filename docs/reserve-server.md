# Reserve server

The reserve runs on the owner's computer only when the primary is unavailable.
It uses its own PostgreSQL database, blob directory, JWT secret, and API
process. Replace every placeholder with the owner's value; do not put a real
secret in the repository.

## One-time setup

1. Copy `services/api/.env.reserve.example` to
   `services/api/.env.reserve` and fill its placeholders, including a database
   URL whose database is `pawlaris_reserve`, a reserve-only `JWT_SECRET`, and a
   reserve blob directory.
2. Install PostgreSQL 16 client tools, `uv`, `age`, Windows `tar.exe`, and
   Tailscale. In `psql` as a PostgreSQL administrator, create the reserve login
   with a password typed at the prompt:

   ```sql
   \prompt 'Reserve password: ' reserve_password
   CREATE ROLE pawlaris_reserve LOGIN CREATEDB PASSWORD :'reserve_password';
   ```

   `start` creates the `pawlaris_reserve` database; do not create it beforehand.
   Use the created role and password in the reserve `DATABASE_URL`.
3. Store the private age key at `<reserve-age-key-path>` and make the file
   readable only by the owner's Windows account. Set
   `PAWLARIS_AGE_KEY_PATH`, `PAWLARIS_BACKUP_ROOT`, and
   `PAWLARIS_RESERVE_ENV_PATH` as needed.
4. Sign in to Tailscale on the computer and both phones, and enable HTTPS for
   the reserve's tailnet address.

## Commands

Start the reserve from the newest verified archive pulled by
`scripts/pull-backup.ps1`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/reserve.ps1 start
```

Stop the published API and keep its database for the next start:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/reserve.ps1 stop
```

## Phones

The phones reach the reserve through Tailscale. On arrival, a phone reseeds
the acknowledged rows it holds, performs a full pull, then drains its outbox;
the reserve does not contact the primary. Account-management actions that are
primary-only remain disabled, and the app identifies the reserve connection.
