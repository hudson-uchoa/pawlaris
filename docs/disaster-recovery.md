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
   and record them before moving them:

   ```sh
   postgres_volume="$(sudo docker volume ls -q --filter label=com.docker.compose.volume=postgres_data)"
   blobs_volume="$(sudo docker volume ls -q --filter label=com.docker.compose.volume=blobs)"
   test -n "$postgres_volume" && test -n "$blobs_volume"
   printf 'old postgres volume: %s\nold blobs volume: %s\n' "$postgres_volume" "$blobs_volume"
   drill_suffix="drill-$(date +%Y%m%d-%H%M%S)"
   sudo docker volume rename "$postgres_volume" "${postgres_volume}-${drill_suffix}"
   sudo docker volume rename "$blobs_volume" "${blobs_volume}-${drill_suffix}"
   ```

   Record the two old names and the suffix. Renaming sets the data aside;
   never run `docker volume rm` or delete either volume during this drill.

4. **Put the infrastructure and verified archive on the box.** From the
   owner's computer, copy the current `infra/` directory and the newest
   archive. The archive is copied from the directory verified in step 1:

   ```powershell
   scp -r -i "<owner-ssh-key-path>" "<owner-repo-path>\infra" `
     "<box-user>@<box-host>:/opt/pawlaris/"
   $archive = Get-ChildItem -LiteralPath "<owner-backup-directory>" -Filter '*.tar.age' -File |
     Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
   scp -i "<owner-ssh-key-path>" $archive.FullName `
     "<box-user>@<box-host>:/opt/pawlaris/restore.tar.age"
   scp -i "<owner-ssh-key-path>" "<owner-age-key-path>" `
     "<box-user>@<box-host>:/opt/pawlaris/restore.age"
   ```

   The age key file above is the private key on the owner's computer, not the
   public `BACKUP_AGE_RECIPIENT` in `.env`. It is temporarily copied to the box
   only because `restore.sh` needs it.

5. **Restore the database and photos.** On the box, run the existing restore
   script from `/opt/pawlaris/infra`. It creates fresh named volumes, decrypts
   and verifies the supplied archive through `age`, restores PostgreSQL, copies
   the archived blobs, and assigns a new `sync_epoch`:

   ```sh
   cd /opt/pawlaris/infra
   sudo ./restore.sh /opt/pawlaris/restore.tar.age /opt/pawlaris/restore.age
   sudo rm -f /opt/pawlaris/restore.age
   ```

   Confirm that the command printed a new epoch. Remove the temporary key even
   if the restore succeeds; it must not remain on the box. The encrypted
   archive may be removed after the drill if the owner does not need it there:

   ```sh
   sudo rm -f /opt/pawlaris/restore.tar.age
   ```

6. **Reapply the tailnet ingress.** On the box, start the restored stack,
   check its loopback health, publish it through the existing Tailscale host
   service, and check the service configuration:

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
    new_postgres_volume="$(sudo docker volume ls -q --filter label=com.docker.compose.volume=postgres_data)"
    new_blobs_volume="$(sudo docker volume ls -q --filter label=com.docker.compose.volume=blobs)"
    sudo docker volume rename "$new_postgres_volume" "${new_postgres_volume}-failed-drill"
    sudo docker volume rename "$new_blobs_volume" "${new_blobs_volume}-failed-drill"
    sudo docker volume rename "<old-postgres-volume>-<drill-suffix>" "<old-postgres-volume>"
    sudo docker volume rename "<old-blobs-volume>-<drill-suffix>" "<old-blobs-volume>"
    sudo docker compose --env-file ../.env up -d
    ```

    Replace the two `<old-...>-<drill-suffix>` arguments with the exact names
    printed and recorded in step 3. The `-failed-drill` volumes remain available
    for investigation; do not delete them as part of this drill.
