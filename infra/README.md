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
