# Disaster recovery drill

This drill reconstructs the primary from the newest verified archive and
checks that the phones repair the interval after that archive. It is an owner
operation on the real box. Replace every angle-bracket placeholder with the
owner's value before running a command. Do not put the age private key in the
repository.

1. **Record the start and confirm the newest backup.** On the owner's Windows
   computer, choose the local backup directory and the SSH key used by the
   pull script. The script checks `last_backup.json`, the 48-hour limit, and the
   archive checksum:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File "<owner-repo-path>\scripts\pull-backup.ps1" `
     -BoxHost "<box-host>" `
     -BoxUser "<box-user>" `
     -SshKeyPath "<owner-ssh-key-path>" `
     -LocalRoot "<owner-backup-directory>"
   ```

   Record the start time as `<drill-start-time>`. The newest `.tar.age` in
   `<owner-backup-directory>` is the archive used below. Do not continue if
   the pull or checksum verification fails.

2. **Make the post-backup phone change.** On one release phone, after the
   backup in step 1, make one ordinary family-data change and record what it
   was as `<post-backup-change>`. Keep the app online until its outbox is empty
   and the change is visible on the server. This is the change that must return
   after the restored server gets its new epoch.

3. **Stop the primary without deleting its data.** From an SSH session to the
   box, run:

   ```sh
   cd /opt/pawlaris/infra
   sudo docker compose --env-file ../.env down
   ```

   The database and photos are in the Docker named volumes `postgres_data` and
   `blobs`, not in host directories. Identify the actual Compose volume names
   and record them before moving them. The label filter must return exactly one
   name for each volume; stop otherwise. Set `<postgres-image-from-compose>` to
   the PostgreSQL image named by the compose file:

   ```sh
   mapfile -t postgres_volumes < <(sudo docker volume ls -q --filter label=com.docker.compose.volume=postgres_data)
   mapfile -t blobs_volumes < <(sudo docker volume ls -q --filter label=com.docker.compose.volume=blobs)
   test "${#postgres_volumes[@]}" -eq 1
   test "${#blobs_volumes[@]}" -eq 1
   postgres_volume="${postgres_volumes[0]}"
   blobs_volume="${blobs_volumes[0]}"
   printf 'old postgres volume: %s\nold blobs volume: %s\n' "$postgres_volume" "$blobs_volume"
   drill_suffix="drill-$(date +%Y%m%d-%H%M%S)"
   postgres_drill="${postgres_volume}-${drill_suffix}"
   blobs_drill="${blobs_volume}-${drill_suffix}"
   image="<postgres-image-from-compose>"
   sudo docker volume create "$postgres_drill" >/dev/null
   sudo docker volume create "$blobs_drill" >/dev/null
   sudo docker run --rm -v "$postgres_volume:/from:ro" -v "$postgres_drill:/to" "$image" cp -a /from/. /to/
   sudo docker run --rm -v "$blobs_volume:/from:ro" -v "$blobs_drill:/to" "$image" cp -a /from/. /to/
   compare_volume() {
     local source="$1" copy="$2"
     test "$(sudo docker run --rm -v "$source:/data:ro" "$image" sh -c 'find /data -type f | wc -l; du -s /data | cut -f1')" =
       "$(sudo docker run --rm -v "$copy:/data:ro" "$image" sh -c 'find /data -type f | wc -l; du -s /data | cut -f1')"
   }
   compare_volume "$postgres_volume" "$postgres_drill"
   compare_volume "$blobs_volume" "$blobs_drill"
   sudo docker volume rm "$postgres_volume" "$blobs_volume"
   ```

   Record the two old names and the suffix. The copies are the set-aside data;
   the originals are removed only after each copy's file count and `du -s`
   match.

4. **Put the infrastructure and verified archive on the box.** From the
   owner's computer, create a private staging directory in the SSH user's
   home, then copy the current `infra/` directory, the newest archive, and the
   private key there. The archive is copied from the directory verified in
   step 1:

   ```powershell
   $staging = '<box-user-home>/pawlaris-restore-<drill-id>'
   ssh -i "<owner-ssh-key-path>" "<box-user>@<box-host>" "mkdir -m 700 -p '$staging'"
   scp -r -i "<owner-ssh-key-path>" "<owner-repo-path>\infra" `
     "<box-user>@<box-host>:$staging/"
   $archive = Get-ChildItem -LiteralPath "<owner-backup-directory>" -Filter '*.tar.age' -File |
     Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
   scp -i "<owner-ssh-key-path>" $archive.FullName `
     "<box-user>@<box-host>:$staging/restore.tar.age"
   scp -i "<owner-ssh-key-path>" "<owner-age-key-path>" `
     "<box-user>@<box-host>:$staging/restore.age"
   ```

   The age key file above is the private key on the owner's computer, not the
   public `BACKUP_AGE_RECIPIENT` in `.env`. It is temporarily copied to the
   owner's SSH home only because `restore.sh` needs it. Do not copy it into
   `/opt/pawlaris`.

5. **Restore the database and photos.** On the box, run the existing restore
   script from `/opt/pawlaris/infra`. First install the copied infrastructure
   with root permissions and restore from the staging directory. Compose
   creates the empty named volumes because step 3 set the old ones aside. The
   script decrypts the supplied archive with `age`, extracts it, restores
   PostgreSQL, copies the archived blobs, assigns a new `sync_epoch`, and
   starts the API:

   ```sh
   staging='<box-user-home>/pawlaris-restore-<drill-id>'
   sudo cp -r "$staging/infra" /opt/pawlaris/infra
   sudo chmod 755 /opt/pawlaris/infra/*.sh
   cd /opt/pawlaris/infra
   set +e
   sudo ./restore.sh "$staging/restore.tar.age" "$staging/restore.age"
   restore_status=$?
   sudo rm -f "$staging/restore.age"
   exit "$restore_status"
   ```

   Confirm that the command printed a new epoch. The key removal runs after
   `restore.sh` whether it succeeds or fails; it must not remain on the box.
   The encrypted archive may be removed after the drill if the owner does not
   need it there:

   ```sh
   sudo rm -f "$staging/restore.tar.age"
   ```

6. **Reapply the tailnet ingress.** On the box, start the restored stack and
   use the loopback health check and `tailscale serve status` below to confirm
   that the stack and ingress are up. This is a check of the service already
   started by `restore.sh`, not another restore:

   ```sh
   cd /opt/pawlaris/infra
   sudo docker compose --env-file ../.env up -d
   curl --fail http://127.0.0.1:8000/api/v1/health
   sudo tailscale serve --bg --https=443 http://127.0.0.1:8000
   sudo tailscale serve status
   ```

   The expected phone URL is
   `https://<box>.ts.net/api/v1`; the WebSocket URL is
   `wss://<box>.ts.net/api/v1/ws`. The phones and the box must be in the
   owner's tailnet.

7. **Deploy the restored image.** From the box, use the tag that was running
   before the drill, recorded as `<restored-image-tag>`:

   ```sh
   cd /opt/pawlaris/infra
   sudo ./deploy.sh <restored-image-tag>
   ```

   Wait for the health check to pass. If the release tag is different, use the
   exact tag recorded in `/opt/pawlaris/.env` before the drill or the tag the
   owner selected for this rebuild.

8. **Let both phones arrive at the restored epoch.** With Tailscale enabled,
   open the app on both release phones and leave them online. Each phone sees
   the restored server's new epoch, sends the acknowledged rows it holds
   before pulling, completes its full pull, and then drains its outbox. This is
   the `arrive(server)` sequence: no phone-held row is removed before the pull
   ends. Verify on both phones that the restored family data and photos from
   the archive are present, and that `<post-backup-change>` is on the server
   again. A change still waiting in an outbox is sent again; a change already
   held by the phone is included in its reseed. The server merges rows by the
   specified change-time rules.

9. **Record the result against the limit.** Record the finish time as
   `<drill-finish-time>` and calculate the elapsed time as
   `<drill-finish-time> - <drill-start-time> = <total-drill-time>`. The drill
   passes only when `<total-drill-time>` is less than or equal to one hour and
   both phones show the restored data, photos, and `<post-backup-change>`.

10. **Failure recovery: put the old volumes back.** If the drill fails and the
    old data must be restored, stop the stack and keep the newly created
    volumes rather than deleting them. Use the old volume names recorded in
    step 3 (`<old-postgres-volume>` and `<old-blobs-volume>`):

    ```sh
    cd /opt/pawlaris/infra
    sudo docker compose --env-file ../.env down
    mapfile -t new_postgres_volumes < <(sudo docker volume ls -q --filter label=com.docker.compose.volume=postgres_data)
    mapfile -t new_blobs_volumes < <(sudo docker volume ls -q --filter label=com.docker.compose.volume=blobs)
    test "${#new_postgres_volumes[@]}" -eq 1
    test "${#new_blobs_volumes[@]}" -eq 1
    new_postgres_volume="${new_postgres_volumes[0]}"
    new_blobs_volume="${new_blobs_volumes[0]}"
    image="<postgres-image-from-compose>"
    failed_postgres="${new_postgres_volume}-failed-drill"
    failed_blobs="${new_blobs_volume}-failed-drill"
    sudo docker volume create "$failed_postgres" >/dev/null
    sudo docker volume create "$failed_blobs" >/dev/null
    sudo docker run --rm -v "$new_postgres_volume:/from:ro" -v "$failed_postgres:/to" "$image" cp -a /from/. /to/
    sudo docker run --rm -v "$new_blobs_volume:/from:ro" -v "$failed_blobs:/to" "$image" cp -a /from/. /to/
    compare_volume() {
      local source="$1" copy="$2"
      test "$(sudo docker run --rm -v "$source:/data:ro" "$image" sh -c 'find /data -type f | wc -l; du -s /data | cut -f1')" =
        "$(sudo docker run --rm -v "$copy:/data:ro" "$image" sh -c 'find /data -type f | wc -l; du -s /data | cut -f1')"
    }
    compare_volume "$new_postgres_volume" "$failed_postgres"
    compare_volume "$new_blobs_volume" "$failed_blobs"
    sudo docker volume rm "$new_postgres_volume" "$new_blobs_volume"
    sudo docker volume create "<old-postgres-volume>" >/dev/null
    sudo docker volume create "<old-blobs-volume>" >/dev/null
    sudo docker run --rm -v "<old-postgres-volume>-<drill-suffix>:/from:ro" -v "<old-postgres-volume>:/to" "$image" cp -a /from/. /to/
    sudo docker run --rm -v "<old-blobs-volume>-<drill-suffix>:/from:ro" -v "<old-blobs-volume>:/to" "$image" cp -a /from/. /to/
    compare_volume "<old-postgres-volume>-<drill-suffix>" "<old-postgres-volume>"
    compare_volume "<old-blobs-volume>-<drill-suffix>" "<old-blobs-volume>"
    sudo docker compose --env-file ../.env up -d
    ```

    Replace the placeholders with the exact names recorded in step 3. Compare
    the restored copies by file count and `du -s` before restarting Compose.
    The `-failed-drill` volumes and the set-aside drill volumes remain available
    for investigation; do not delete them as part of this drill.
