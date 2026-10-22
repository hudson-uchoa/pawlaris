# Real-phone E2E checks

Run from the repository root in PowerShell 5.1, one command at a time.
Use two real Android phones and the dev API described in [build.md](build.md).
The flows have not been run by the implementer. Record their actual results
in [evidence/P7-5.md](evidence/P7-5.md). Use a bundled build for offline
restart checks; a dev client that needs Metro cannot prove offline startup.

Use a disposable development database and blob directory, separate from the
family's everyday records. Set the API environment locally to that database
before migration, bootstrap and server startup. `Settings` loads the ignored
`services/api/.env`; do not display, copy into evidence, or commit that file.
Do not reset an existing database. The existing `app.cli bootstrap` refuses
to seed when any family exists. It is the API's family seeder; there is no
general-purpose sample-data seeder. The performance seed makes 90 tasks and
is unsuitable for the isolated scenarios below.

```powershell
uv run --directory services/api alembic upgrade head
uv run --directory services/api python -m app.cli bootstrap --family 'E2E Family' --timezone America/Sao_Paulo --user 'Tester A:<test-email-a>:leader' --user 'Tester B:<test-email-b>:leader'
uv run --directory services/api uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Replace the email placeholders locally with distinct test identities before
running bootstrap. It prompts for each password without echoing it. Keep
the API terminal running; use another terminal for the commands below.
The phones must use the same test family, with no other clients editing it.
Keep the family date unchanged throughout a run.

Install the current build on both phones. Grant camera and precise location
permissions in system Settings. Complete the location rationale ladder,
notification and battery steps before the walk test, then discard any setup
walk. On Android 12 or newer, select Maestro's installed driver as the mock
location app in Developer options. Confirm `setLocation` works on the real
phone before recording the walk result. No emulator is evidence.

The launcher is `C:/Tools/maestro/bin/maestro.bat` (H7). The following helper
always specifies a device and keeps Maestro's reports, screenshots and logs
under the ignored media directory. Substitute `<serial>` only locally.
Never retain actual serials, LAN addresses, passwords or session tokens in
repository evidence. Private media stays in `docs/evidence/media/`.

```powershell
$maestro = 'C:/Tools/maestro/bin/maestro.bat'
$phone = '<serial>'
function Invoke-E2EFlow([string]$name, [string[]]$variables = @()) {
    & $maestro --device $phone test @variables "apps/mobile/.maestro/$name.yaml" --test-output-dir "docs/evidence/media/P7-5/$name" --debug-output "docs/evidence/media/P7-5/$name"
    if ($LASTEXITCODE -ne 0) { throw "Flow failed: $name" }
}
```

Start signed out on phone A. Read its test credentials interactively; do not
paste passwords into shell history. Run flow 01, which waits for both the
dashboard and an empty synchronized outbox. Repeat login in a separate
terminal on phone B with its own credentials and device. Keep this terminal
on phone A with A's credentials for the remaining setup and flows.
Maestro may retain entered text in its local reports: those remain ignored.

```powershell
$credentials = Get-Credential -Message 'Test account for the selected phone'
Invoke-E2EFlow '01-login' @('-e', "EMAIL=$($credentials.UserName)", '-e', "PASSWORD=$($credentials.GetNetworkCredential().Password)")
Invoke-E2EFlow '04-pet-and-weight'
```

Flow 04 starts with no pets, creates the only dog, and saves its first weight.
It selects the newly created pet by index only under that empty-family
precondition. The registry in `src/features/shell/e2eIDs.ts` holds the proposed
additional selectors from Q-64; existing spec selectors remain intact.

Use the API's existing login and `/sync` routes to obtain the dog's UUID and
to seed subsequent tasks through the normal idempotent write route. Keep
responses and bearer credentials in memory. This helper reads every page.

```powershell
$api = 'http://127.0.0.1:8000/api/v1'
$body = @{ email = $credentials.UserName; password = $credentials.GetNetworkCredential().Password } | ConvertTo-Json
$session = Invoke-RestMethod -Method Post -Uri "$api/auth/login" -ContentType application/json -Body $body
$headers = @{ Authorization = "Bearer $($session.access_token)" }
Remove-Variable body
function Read-E2ERows {
    $cursor = 0
    do {
        $page = Invoke-RestMethod -Uri "$api/sync?since=$cursor" -Headers $headers
        $page.changes
        $cursor = $page.revision
    } while ($page.has_more)
}
$rows = @(Read-E2ERows)
$petId = ($rows | Where-Object { $_.entity -eq 'pets' -and $_.row.name -eq 'E2E Dog' }).row.id
if (-not $petId) { throw 'Run flow 04 first' }
Invoke-E2EFlow '05-task-create-and-fork' @('-e', "PET_ID=$petId")
Invoke-E2EFlow '06-walk'
```

Flow 05 requires zero templates at entry. It creates the only daily task,
increments the schedule interval to two, checks that the old task has no
occurrence today, then checks the replacement is absent tomorrow and present
the following day. Return to today. Flow 06 uses synthetic coordinates near
zero and Maestro's [travel command](https://docs.maestro.dev/reference/commands-available/travel)
at 1 m/s, pauses and resumes, and explicitly saves the walk. Allow about
70 seconds for the mocked motion. It checks an accepted location marker,
the saved map and history row; it does not claim a GPS accuracy measurement.

For the remaining scenarios, end existing templates through the API so they
cannot interfere with wildcard queue selection. This preserves history.
Choose today's date in the family's timezone; do not run across midnight.
The helpers below generate UUIDs on the caller and retain each request's
body and idempotency key for retries. On failure, stop: retry the same request
with the same ID/key, rather than running a create helper again.

```powershell
$testDate = '<YYYY-MM-DD>'
$yesterday = [DateTime]::ParseExact($testDate, 'yyyy-MM-dd', $null).AddDays(-1).ToString('yyyy-MM-dd')
function Send-E2EWrite([string]$method, [string]$path, $payload) {
    $script:lastWriteHeaders = @{ Authorization = $headers.Authorization; 'Idempotency-Key' = [guid]::NewGuid().ToString() }
    $script:lastWriteBody = $payload | ConvertTo-Json -Depth 8
    $script:lastWriteMethod = $method
    $script:lastWriteUri = "$api$path"
    Invoke-RestMethod -Method $lastWriteMethod -Uri $lastWriteUri -Headers $lastWriteHeaders -ContentType application/json -Body $lastWriteBody
}
function End-E2ETask([string]$id) {
    $null = Send-E2EWrite 'Patch' "/tasks/$id" @{ ends_on = $yesterday }
}
function New-E2ETask([string]$title, [bool]$photo = $false) {
    Send-E2EWrite 'Post' '/tasks' @{
        id = [guid]::NewGuid().ToString(); title = $title
        recurrence = @{ freq = 'daily'; interval = 1 }
        times_of_day = @(); starts_on = $testDate; pet_ids = @($petId)
        completion_mode = 'together'; assigned_to = $null
        requires_photo = $photo; reminder_class = 'routine'
    }
}
$rows = @(Read-E2ERows)
$rows | Where-Object { $_.entity -eq 'task_templates' -and -not $_.row.deleted_at } | ForEach-Object { End-E2ETask $_.row.id }
$normal = New-E2ETask 'E2E Complete'
# Wait for phone A to show this card and an empty synchronized outbox.
Invoke-E2EFlow '02-complete-and-undo' @('-e', "TASK_ID=$($normal.id)", '-e', "OCCURRENCE_KEY=$testDate", '-e', "COMPLETER_NAME=$($session.user.display_name)")
End-E2ETask $normal.id
$proof = New-E2ETask 'E2E Photo' $true
# Wait for its card to arrive before entering airplane mode.
Invoke-E2EFlow '03-photo-proof-offline' @('-e', "TASK_ID=$($proof.id)", '-e', "OCCURRENCE_KEY=$testDate")
End-E2ETask $proof.id
$queue = @(1..5 | ForEach-Object { New-E2ETask "E2E Queue $_" })
# Wait until exactly five incomplete cards and synced-0 are on Hoje.
$queueVariables = @('-e', "OCCURRENCE_KEY=$testDate")
1..5 | ForEach-Object { $queueVariables += @('-e', "QUEUE_TASK_$_=$($queue[$_ - 1].id)") }
Invoke-E2EFlow '07-offline-queue' $queueVariables
```

Flow 03 requires airplane mode to disable all networking, including Wi-Fi.
Turn off Wi-Fi's ability to remain enabled in airplane mode beforehand.
The offline-state assertion fails if the phone remains connected. Capture
only a synthetic scene. The flow checks queued photo state, process restart,
then uploaded state and the disappearance of the upload label. Its completion
hook restores airplane mode even after failure; check connectivity afterward.
Flow 07 also restores it. Set normal font/display scaling so all five cards
fit on screen. The queue flow records exactly five pending writes, restarts
offline, verifies the completed cards persist, and reconnects to synced-0.

Flows 08–09 have distinct performance fixtures. Follow
[evidence/P7-4.md](evidence/P7-4.md) to prepare the existing 90-task seed.
After those measurements, prepare the indicated start screen before each
standalone flow: Pets for 08, Hoje for 09, with no drawer or modal open.

```powershell
Invoke-E2EFlow '08-hero-loop'
Invoke-E2EFlow '09-dashboard-fling'
```

For the two-phone check, use a fresh incomplete, all-day, together-mode task
without a photo or timer. Both phones must be online, synchronized, and open
on that task's detail with today's checkbox visible. Use A's actual test
display name, as returned by login. Do not run the paired flows individually
or include them in a recursive directory run; the coordinator is required.

```powershell
$paired = New-E2ETask 'E2E Two Phone'
$env:E2E_TASK_ID = $paired.id
$env:E2E_OCCURRENCE_KEY = $testDate
$env:E2E_COMPLETER_NAME = $session.user.display_name
node scripts/e2e-two-device.mjs <serialA> <serialB>
```

Replace the angle-bracket placeholders with quoted serial arguments locally.
The runner invokes the installed batch launcher with `--device` separately
for A and B, in parallel. Maestro's host-side
[HTTP client](https://docs.maestro.dev/maestro-flows/javascript/make-http-requests)
talks to a temporary loopback-only Node coordinator; no device port forwarding
or phone clock synchronization is needed. A and B first prove the occurrence
is incomplete. The readiness barrier excludes both CLI startups. Node measures
from immediately before A's tap until B reads the attribution by ID and
reports the exact author prefix and time. That is a conservative upper bound
including Maestro overhead, not a subtraction-based estimate. At most 3000 ms
passes R5.8; 3001 ms fails. A stale completion, wrong name, missing observation,
invalid event or failure in either flow fails the run. Each process has a
120-second setup/run timeout; that timeout does not extend the R5.8 budget.
Undo on A and wait for both phones to show incomplete before repeating.

To run the deterministic checks without phones:

```powershell
node --test scripts/e2e-two-device.test.mjs scripts/maestro-selectors.test.mjs
```

These inject commands and the monotonic clock and use no adb, Maestro,
network server, real wait or real clock. The selector test recursively reads
every flow, including 08–09 and the two-phone directory. Its deliberately bad
fixture strings prove text selection is rejected without changing a real
flow. The small guard requires block-form `id:` selectors; input text and
assertions about copied content remain allowed.
