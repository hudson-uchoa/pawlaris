[CmdletBinding()]
param(
    [ValidateSet('start', 'stop')]
    [string]$Command,
    [string]$BackupRoot = $env:PAWLARIS_BACKUP_ROOT,
    [string]$AgeKeyPath = $env:PAWLARIS_AGE_KEY_PATH,
    [string]$ReserveEnvPath = $env:PAWLARIS_RESERVE_ENV_PATH,
    [string]$PidPath = $env:PAWLARIS_RESERVE_PID_PATH,
    [string]$LogPath = $env:PAWLARIS_RESERVE_LOG_PATH,
    [int]$Port = 0,
    [string]$RepoRoot
)

$ErrorActionPreference = 'Stop'
$apiProcess = $null

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
    $RepoRoot = Split-Path -Parent $PSScriptRoot
}

function Fail([string]$Message) {
    throw $Message
}

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )

    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$FilePath failed with exit code $LASTEXITCODE."
    }
}

function Read-EnvironmentFile([string]$Path) {
    $values = @{}
    foreach ($line in Get-Content -LiteralPath $Path) {
        $trimmed = $line.Trim()
        if ($trimmed.Length -eq 0 -or $trimmed.StartsWith('#')) {
            continue
        }
        $separator = $trimmed.IndexOf('=')
        if ($separator -lt 1) {
            throw "Invalid reserve environment entry."
        }
        $name = $trimmed.Substring(0, $separator).Trim()
        $value = $trimmed.Substring($separator + 1).Trim()
        if ($value.Length -ge 2 -and $value.StartsWith('"') -and $value.EndsWith('"')) {
            $value = $value.Substring(1, $value.Length - 2)
        } elseif ($value.Length -ge 2 -and $value.StartsWith("'") -and $value.EndsWith("'")) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        $values[$name] = $value
    }
    return $values
}

function Set-ProcessEnvironment([hashtable]$Values) {
    foreach ($name in $Values.Keys) {
        [Environment]::SetEnvironmentVariable($name, [string]$Values[$name], 'Process')
    }
}

function Get-DatabaseName([string]$DatabaseUrl) {
    $match = [regex]::Match($DatabaseUrl, '^[^:]+://[^/]+/([^?/#]+)')
    if (-not $match.Success) {
        throw 'DATABASE_URL must contain a database name.'
    }
    return $match.Groups[1].Value
}

function Configure-PostgresEnvironment([string]$DatabaseUrl) {
    $libpqUrl = $DatabaseUrl -replace '^postgresql\+asyncpg://', 'postgresql://'
    try {
        $uri = [Uri]$libpqUrl
        [Environment]::SetEnvironmentVariable('PGHOST', $uri.Host, 'Process')
        if ($uri.Port -gt 0) {
            [Environment]::SetEnvironmentVariable('PGPORT', [string]$uri.Port, 'Process')
        }
        if ($uri.UserInfo.Contains(':')) {
            $userInfo = $uri.UserInfo.Split(':', 2)
            [Environment]::SetEnvironmentVariable('PGUSER', [Uri]::UnescapeDataString($userInfo[0]), 'Process')
            [Environment]::SetEnvironmentVariable('PGPASSWORD', [Uri]::UnescapeDataString($userInfo[1]), 'Process')
        }
    } catch {
        throw 'DATABASE_URL is not a valid PostgreSQL URL.'
    }
}

function Get-NewestArchive([string]$Root) {
    $archive = Get-ChildItem -LiteralPath $Root -Filter '*.tar.age' -File |
        Sort-Object LastWriteTimeUtc -Descending |
        Select-Object -First 1
    if ($null -eq $archive) {
        throw 'No pulled backup archive was found.'
    }
    return $archive
}

function Assert-ArchiveChecksum([System.IO.FileInfo]$Archive) {
    $sidecar = $Archive.FullName + '.sha256'
    if (-not (Test-Path -LiteralPath $sidecar -PathType Leaf)) {
        throw 'The newest backup archive has no checksum file.'
    }
    $sidecarText = Get-Content -Raw -LiteralPath $sidecar
    $match = [regex]::Match($sidecarText, '(?i)\b([0-9a-f]{64})\b')
    if (-not $match.Success) {
        throw 'Backup checksum verification failed.'
    }
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $Archive.FullName).Hash
    if ($actual -ine $match.Groups[1].Value) {
        throw 'Backup checksum verification failed.'
    }
}

function Stop-ReserveApi {
    if (-not (Test-Path -LiteralPath $PidPath -PathType Leaf)) {
        return
    }
    $pidText = (Get-Content -Raw -LiteralPath $PidPath).Trim()
    $processId = 0
    if (-not [int]::TryParse($pidText, [ref]$processId)) {
        throw 'The reserve PID file is invalid.'
    }
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if ($null -ne $process) {
        Invoke-Checked 'taskkill.exe' @('/PID', [string]$processId, '/T', '/F')
    }
    Remove-Item -Force -LiteralPath $PidPath
}

function Start-Reserve {
    if ([string]::IsNullOrWhiteSpace($BackupRoot)) {
        $BackupRoot = Join-Path $env:USERPROFILE 'Pawlaris backups'
    }
    if ([string]::IsNullOrWhiteSpace($AgeKeyPath)) {
        $AgeKeyPath = Join-Path $env:USERPROFILE '.config\age\keys.txt'
    }
    if ([string]::IsNullOrWhiteSpace($ReserveEnvPath)) {
        $ReserveEnvPath = Join-Path $RepoRoot 'services\api\.env.reserve'
    }
    if ([string]::IsNullOrWhiteSpace($PidPath)) {
        $PidPath = Join-Path $env:LOCALAPPDATA 'Pawlaris\reserve-api.pid'
    }
    if ([string]::IsNullOrWhiteSpace($LogPath)) {
        $LogPath = Join-Path $env:LOCALAPPDATA 'Pawlaris\reserve-api.log'
    }
    if ($Port -eq 0) {
        $Port = 8001
    }

    $archive = Get-NewestArchive $BackupRoot
    if (-not (Test-Path -LiteralPath $AgeKeyPath -PathType Leaf)) {
        throw 'The age key file was not found.'
    }
    Assert-ArchiveChecksum $archive
    if (-not (Test-Path -LiteralPath $ReserveEnvPath -PathType Leaf)) {
        throw 'The reserve environment file was not found.'
    }
    $reserveEnvironment = Read-EnvironmentFile $ReserveEnvPath
    if (-not $reserveEnvironment.ContainsKey('DATABASE_URL')) {
        throw 'The reserve environment has no DATABASE_URL.'
    }
    if (-not $reserveEnvironment.ContainsKey('BLOB_DIR') -or
        [string]::IsNullOrWhiteSpace([string]$reserveEnvironment['BLOB_DIR'])) {
        throw 'The reserve environment has no BLOB_DIR.'
    }
    $databaseName = Get-DatabaseName ([string]$reserveEnvironment['DATABASE_URL'])
    if ($databaseName -cne 'pawlaris_reserve') {
        throw 'The reserve DATABASE_URL must name pawlaris_reserve.'
    }

    Stop-ReserveApi

    $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('pawlaris-reserve-' + [guid]::NewGuid().ToString('N'))
    try {
        New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
        Set-ProcessEnvironment $reserveEnvironment
        Configure-PostgresEnvironment ([string]$reserveEnvironment['DATABASE_URL'])
        $payload = Join-Path $tempRoot 'payload.tar'
        $dbDump = Join-Path $tempRoot 'db.dump'
        $blobsTar = Join-Path $tempRoot 'blobs.tar'
        $blobsSource = Join-Path $tempRoot 'blobs'

        Invoke-Checked 'age' @('-d', '-i', $AgeKeyPath, '-o', $payload, $archive.FullName)
        Invoke-Checked 'tar.exe' @('-C', $tempRoot, '-xf', $payload)
        Invoke-Checked 'tar.exe' @('-C', $tempRoot, '-xf', $blobsTar)
        if (-not (Test-Path -LiteralPath $dbDump -PathType Leaf) -or
            -not (Test-Path -LiteralPath $blobsSource -PathType Container)) {
            throw 'The backup archive does not contain db.dump and blobs.'
        }

        Invoke-Checked 'dropdb' @('--if-exists', '--force', 'pawlaris_reserve')
        Invoke-Checked 'createdb' @('pawlaris_reserve')
        Invoke-Checked 'pg_restore' @('--exit-on-error', '--no-owner', '-d', 'pawlaris_reserve', $dbDump)

        $blobDirectory = [string]$reserveEnvironment['BLOB_DIR']
        if ([string]::IsNullOrWhiteSpace($blobDirectory)) {
            $blobDirectory = Join-Path $RepoRoot 'data\reserve-blobs'
        }
        New-Item -ItemType Directory -Force -Path $blobDirectory | Out-Null
        Get-ChildItem -LiteralPath $blobDirectory -Force | Remove-Item -Recurse -Force
        Get-ChildItem -LiteralPath $blobsSource -Force | Copy-Item -Destination $blobDirectory -Recurse -Force

        Invoke-Checked 'psql' @('-X', '-v', 'ON_ERROR_STOP=1', '-d', 'pawlaris_reserve', '-c', 'UPDATE server_meta SET sync_epoch = gen_random_uuid();')
        Push-Location (Join-Path $RepoRoot 'services\api')
        try {
            Invoke-Checked 'uv' @('run', 'alembic', 'upgrade', 'head')
        } finally {
            Pop-Location
        }

        $logDirectory = Split-Path -Parent $LogPath
        New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
        $errorLogPath = $LogPath + '.err'
        $apiProcess = Start-Process -FilePath 'uv' -WorkingDirectory (Join-Path $RepoRoot 'services\api') -ArgumentList @('run', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', [string]$Port, '--workers', '1', '--no-access-log') -RedirectStandardOutput $LogPath -RedirectStandardError $errorLogPath -PassThru
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $PidPath) | Out-Null
        Set-Content -LiteralPath $PidPath -Value ([string]$apiProcess.Id) -NoNewline

        $healthUrl = "http://127.0.0.1:$Port/api/v1/health"
        $healthy = $false
        for ($attempt = 0; $attempt -lt 60; $attempt++) {
            Start-Sleep -Seconds 1
            try {
                $response = Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -TimeoutSec 2
                if ($response.StatusCode -eq 200 -and $response.Content -match '"role"\s*:\s*"reserve"') {
                    $healthy = $true
                    break
                }
            } catch {
            }
        }
        if (-not $healthy) {
            throw 'The reserve API did not become healthy.'
        }
        Invoke-Checked 'tailscale' @('serve', '--bg', '--https=443', "http://127.0.0.1:$Port")
    } catch {
        if ($null -ne $apiProcess) {
            try {
                Invoke-Checked 'taskkill.exe' @('/PID', [string]$apiProcess.Id, '/T', '/F')
            } catch {
            }
        }
        Stop-ReserveApi
        if (Test-Path -LiteralPath $PidPath) {
            Remove-Item -Force -LiteralPath $PidPath
        }
        throw
    } finally {
        if (Test-Path -LiteralPath $tempRoot) {
            Remove-Item -Recurse -Force -LiteralPath $tempRoot
        }
    }
}

function Stop-Reserve {
    if ([string]::IsNullOrWhiteSpace($PidPath)) {
        $PidPath = Join-Path $env:LOCALAPPDATA 'Pawlaris\reserve-api.pid'
    }
    $tailscaleError = $null
    try {
        Invoke-Checked 'tailscale' @('serve', '--https=443', 'off')
    } catch {
        $tailscaleError = $_
    }
    try {
        Stop-ReserveApi
    } finally {
        if ($null -ne $tailscaleError) {
            throw $tailscaleError
        }
    }
}

try {
    if ($Command -eq 'start') {
        Start-Reserve
    } elseif ($Command -eq 'stop') {
        Stop-Reserve
    } else {
        throw 'Command must be start or stop.'
    }
    exit 0
} catch {
    Write-Error $_.Exception.Message
    exit 1
}
