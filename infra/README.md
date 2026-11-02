# infra

The box keeps the Pawlaris stack under `/opt/pawlaris`. P8-1 provides the
compose foundation and bootstrap; later tasks add the selected ingress,
deployment, backup, and restore operations.

## Bootstrap

Run the script on a fresh Ubuntu box as root. It installs the required base
packages, enables Docker, creates the application layout, provisions a 2 GiB
swap file, writes `/opt/pawlaris/.env` with mode `600`, and checks that SSH
password authentication is disabled.

```sh
sudo ./infra/bootstrap.sh
```

The script is safe to run again. It does not replace an existing `.env` or
duplicate the swap entry. Set `GHCR_USERNAME` and `GHCR_READ_TOKEN` in the
process environment only when the GHCR package is private; a public package
needs no login. Never put either value in this repository or in the `.env`
template.

Before starting the stack, replace every `REPLACE_...` value in
`/opt/pawlaris/.env` and copy this directory to `/opt/pawlaris/infra`.
The `BACKUP_AGE_RECIPIENT` value is the public `age` recipient only; keep the
private key outside the box and outside this repository.

## Compose

From `/opt/pawlaris/infra`, start the API and PostgreSQL services with:

```sh
docker compose --env-file ../.env up -d
```

The `tunnel`, `caddy`, and `tailnet` profiles are intentionally stubs for
P8-2. Do not enable one until its profile is configured and reviewed.

The API is reachable on the box's loopback at `127.0.0.1:8000` until an ingress
profile is configured. PostgreSQL is never published to the host. The configured Docker
log rotation is `json-file`, 10 MB per file and three files per service.

## Deploy

From the box, run the deployment by tag. The image is pulled from GHCR; it is
never built on the box:

```sh
sudo ./deploy.sh <tag>
```

The script records the running tag in `/opt/pawlaris/.env`, runs migrations in a
one-off API container, starts the stack, and checks
`http://localhost:8000/api/v1/health` for up to 60 seconds. Set `HEALTH_URL`
for a different health endpoint. A failed health check restores the previous
tag and starts it again.

## Backups and maintenance

Bootstrap installs the backup scripts and units under `/opt/pawlaris`. Enable
the timer after reviewing the `.env` recipient:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now pawlaris-nightly.timer
systemctl list-timers pawlaris-nightly.timer
```

The timer runs at 03:30 in `America/Sao_Paulo`. To run it by hand from
`/opt/pawlaris/infra`, use `sudo ./nightly.sh`. Restore a pulled archive with
`sudo ./restore.sh /path/to/YYYY-MM-DD.tar.age /path/to/age.key`; the command
ends by printing the new `sync_epoch`.

On the Windows computer, set `PAWLARIS_BOX_HOST`, `PAWLARIS_BOX_USER`, and
`PAWLARIS_SSH_KEY_PATH`, then register the pull at logon and every six hours:

```powershell
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -ExecutionPolicy Bypass -File "C:\path\to\Pawlaris\scripts\pull-backup.ps1"'
$triggers = @((New-ScheduledTaskTrigger -AtLogOn), (New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Hours 6)))
Register-ScheduledTask -TaskName 'Pawlaris backup pull' -Action $action -Trigger $triggers -Description 'Pull and verify Pawlaris backups'
```
