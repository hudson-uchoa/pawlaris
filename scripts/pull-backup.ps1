[CmdletBinding()]
param(
    [string]$BoxHost = $env:PAWLARIS_BOX_HOST,
    [string]$BoxUser = $env:PAWLARIS_BOX_USER,
    [string]$SshKeyPath = $env:PAWLARIS_SSH_KEY_PATH,
    [string]$LocalRoot = (Join-Path $env:USERPROFILE 'Pawlaris backups')
)

$ErrorActionPreference = 'Stop'
$remoteRoot = '/opt/pawlaris/backups'
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('pawlaris-pull-' + [guid]::NewGuid().ToString('N'))

try {
    if ([string]::IsNullOrWhiteSpace($BoxHost) -or [string]::IsNullOrWhiteSpace($BoxUser) -or
        [string]::IsNullOrWhiteSpace($SshKeyPath)) { throw 'Box host, user, and SSH key path are required.' }
    New-Item -ItemType Directory -Path $tempRoot | Out-Null
    New-Item -ItemType Directory -Force -Path $LocalRoot | Out-Null
    $target = "$BoxUser@$BoxHost"
    $lastPath = Join-Path $tempRoot 'last_backup.json'
    & scp -q -i $SshKeyPath "$target`:$remoteRoot/last_backup.json" $lastPath
    $metadata = Get-Content -Raw -Path $lastPath | ConvertFrom-Json
    if ($metadata.verified -ne $true) { throw 'The latest backup is not verified.' }
    $finished = [DateTimeOffset]::Parse($metadata.finished_at).ToUniversalTime()
    if (([DateTimeOffset]::UtcNow - $finished).TotalHours -gt 48) { throw 'The latest backup is older than 48 hours.' }

    $remoteArchive = (& ssh -q -i $SshKeyPath $target "find $remoteRoot -maxdepth 1 -type f -name '*.tar.age' -printf '%T@ %p\n' | sort -nr | head -n 1").Trim()
    if ($remoteArchive -notmatch '^[0-9.]+ (/opt/pawlaris/backups/[A-Za-z0-9._-]+\.tar\.age)$') { throw 'No valid remote backup archive was found.' }
    $archivePath = $Matches[1]
    $archiveName = Split-Path -Leaf $archivePath
    $tempArchive = Join-Path $tempRoot $archiveName
    $tempChecksum = Join-Path $tempRoot ($archiveName + '.sha256')
    & scp -q -i $SshKeyPath "$target`:$archivePath" $tempArchive
    & scp -q -i $SshKeyPath "$target`:$archivePath.sha256" $tempChecksum
    $expected = ((Get-Content -Raw -Path $tempChecksum) -split '\s+')[0].ToLowerInvariant()
    $actual = (Get-FileHash -Algorithm SHA256 -Path $tempArchive).Hash.ToLowerInvariant()
    if ($expected -ne $actual) { throw 'Backup checksum verification failed.' }

    Move-Item -Force -Path $tempArchive -Destination (Join-Path $LocalRoot $archiveName)
    Move-Item -Force -Path $tempChecksum -Destination (Join-Path $LocalRoot ($archiveName + '.sha256'))
    Get-ChildItem -File -Path $LocalRoot -Filter '*.tar.age' |
        Sort-Object LastWriteTimeUtc -Descending |
        Select-Object -Skip 8 |
        ForEach-Object {
            Remove-Item -Force -Path $_.FullName
            $sidecar = $_.FullName + '.sha256'
            if (Test-Path -LiteralPath $sidecar) { Remove-Item -Force -LiteralPath $sidecar }
        }
    Copy-Item -Force -Path $lastPath -Destination (Join-Path $LocalRoot 'last_backup.json')
    Write-Output "Pulled and verified $archiveName"
    exit 0
} catch {
    Write-Error $_
    exit 1
} finally {
    if (Test-Path -LiteralPath $tempRoot) { Remove-Item -Recurse -Force -LiteralPath $tempRoot }
}
