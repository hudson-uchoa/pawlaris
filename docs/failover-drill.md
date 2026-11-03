# Failover drill

This drill verifies that both release phones move from the primary to the
reserve and back without losing a change. Replace every angle-bracket
placeholder with the owner's value before running a command. Run the box
commands on the box and the PowerShell commands on the owner's computer. Do
not move or delete the primary's data when stopping it.

1. **Prepare both phones.** Install the same release build on both phones.
   Confirm that both phones have the primary URL and the reserve URL baked into
   the build, that Tailscale is enabled, and that the phones are online with
   the primary before the drill. Record `<drill-start-time>`.

2. **Stop the primary without touching its data.** On the box, stop only the
   Compose services. This leaves the named database and blob volumes in place:

   ```sh
   cd /opt/pawlaris/infra
   sudo docker compose --env-file ../.env down
   ```

3. **Make one change on each phone.** While the primary is stopped, make one
   ordinary family-data change on phone A and one on phone B. Record each
   change and the time it was made as `<phone-a-change>`,
   `<phone-a-change-time>`, `<phone-b-change>`, and
   `<phone-b-change-time>`. The changes remain in the phones' outboxes while
   the primary is unavailable.

4. **Start the reserve.** On the owner's computer, run:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/reserve.ps1 start
   ```

   Record `<reserve-start-time>` and the time the reserve health answer is
   first available as `<reserve-health-time>`. Do not continue unless the
   reserve answers `200` with `role: "reserve"` through its Tailscale address.

5. **Let phone A arrive at the reserve.** Leave phone A online with Tailscale
   enabled. After three primary failures spanning at least one minute and a
   healthy reserve response, it switches by itself. If its reserve session is
   not usable, the login screen shows `login-reserve-note`, the email is filled
   in, and it asks for the password once; record
   `<phone-a-password-time>`. It reseeds every acknowledged row it holds,
   performs the full pull, then drains its outbox. Record
   `<phone-a-move-time>`. The connection indicator shows `sincronizado ·
   reserva` or `sincronizando (n) · reserva`.

6. **Let phone B arrive at the reserve.** Leave phone B online with Tailscale
   enabled. It independently follows the same arrival sequence, asks for the
   password once if its reserve session is not usable, and then drains its
   outbox. Record `<phone-b-password-time>` and `<phone-b-move-time>`. Each
   phone must show the other phone's change after the reserve has received and
   pulled it.

7. **Verify the reserve task result.** Complete one task occurrence on phone A
   while both phones use the reserve. Record `<completion-time>`. The completed
   task must appear on phone B. If both servers had held the same occurrence,
   the earlier completion remains live and the other is retained as its
   duplicate; record any duplicate notice as `<duplicate-notice>`.

8. **Verify primary-only account actions.** On the reserve, the role toggle,
   **Remover**, **Convidar**, **Trocar senha** and **Editar nome** are disabled
   and show "Disponível quando o servidor principal voltar." (`reserve-note`).
   The family's name and timezone stay editable. For reference, these are the
   six routes involved:

   - `POST /invites`
   - `POST /auth/redeem`
   - `PATCH /me`
   - `POST /me/password`
   - `PATCH /family/members/{user_id}`
   - `DELETE /family/members/{user_id}`

   The reserve answers `409 reserve_read_only` for these routes and writes
   nothing.

9. **Start the primary again.** On the box, start the existing stack without
   changing its data:

   ```sh
   cd /opt/pawlaris/infra
   sudo docker compose --env-file ../.env up -d
   ```

   Confirm the primary health endpoint answers with `role: "primary"` and
   record `<primary-health-time>`.

10. **Let both phones return to the primary.** Keep both phones online. Each
    phone probes the primary every 60 seconds and returns by itself after three
    consecutive healthy primary answers. Record `<phone-a-return-time>` and
    `<phone-b-return-time>`. Neither phone asks for a password on return. Each
    phone arrives at the primary, reseeds the rows the primary lacks, performs
    the full pull, and drains its outbox. Verify that both changes made on the
    reserve, including the task completion, are present on the primary and on
    both phones. Record `<primary-reconciled-time>`.

11. **Stop the reserve.** On the owner's computer, run:

    ```powershell
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/reserve.ps1 stop
    ```

    Record `<reserve-stop-time>` and confirm the reserve address no longer
    answers.

12. **Record the drill time.** Record `<drill-finish-time>` and calculate the
    time for each move separately: primary to reserve is
    `<phone-a-move-time> - <phone-a-change-time>` and
    `<phone-b-move-time> - <phone-b-change-time>`; reserve to primary is
    `<phone-a-return-time> - <primary-health-time>` and
    `<phone-b-return-time> - <primary-health-time>`. Record the total drill
    duration as `<drill-finish-time> - <drill-start-time>`.
