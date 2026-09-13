param(
  [string]$EnvFile = (Join-Path $PSScriptRoot '..\.env.local'),
  [string]$PostgresBin = 'C:\Users\Lusa\tools\postgresql-17\pgsql\bin',
  [string]$BackupRoot = 'C:\Users\Lusa\AtlasBackups\mastery-engine'
)

$ErrorActionPreference = 'Stop'

# Scope: Atlas application data in `public`. Supabase Auth records and Storage
# file bodies need their own recovery controls.
$sourceHost = 'aws-1-eu-central-1.pooler.supabase.com'
$sourcePort = '5432'
$sourceUser = 'postgres.jipewywqflgandjcqbjl'
$sourceDatabase = 'postgres'

function Assert-LastExitCode([string]$Step) {
  if ($LASTEXITCODE -ne 0) {
    throw "$Step failed with exit code $LASTEXITCODE"
  }
}

function Read-DatabasePassword([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) {
    throw "Environment file not found: $Path"
  }

  $line = Get-Content -LiteralPath $Path |
    Where-Object { $_ -match '^\s*SUPABASE_DB_PASSWORD\s*=' } |
    Select-Object -Last 1
  if ($null -eq $line) {
    throw 'SUPABASE_DB_PASSWORD is missing from the environment file.'
  }

  $value = ($line -split '=', 2)[1].Trim()
  if (($value.StartsWith('"') -and $value.EndsWith('"')) -or
      ($value.StartsWith("'") -and $value.EndsWith("'"))) {
    $value = $value.Substring(1, $value.Length - 2)
  }
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw 'SUPABASE_DB_PASSWORD is empty.'
  }
  return $value
}

function Get-FreeLocalPort {
  $listener = [System.Net.Sockets.TcpListener]::new(
    [System.Net.IPAddress]::Loopback,
    0
  )
  $listener.Start()
  try {
    return $listener.LocalEndpoint.Port
  } finally {
    $listener.Stop()
  }
}

$requiredTools = @(
  'createdb.exe', 'initdb.exe', 'pg_ctl.exe',
  'pg_dump.exe', 'pg_restore.exe', 'psql.exe'
)
foreach ($tool in $requiredTools) {
  $toolPath = Join-Path $PostgresBin $tool
  if (-not (Test-Path -LiteralPath $toolPath)) {
    throw "Required PostgreSQL tool not found: $toolPath"
  }
}

$resolvedBackupRoot = [System.IO.Path]::GetFullPath($BackupRoot)
$expectedBackupRoot = [System.IO.Path]::GetFullPath(
  'C:\Users\Lusa\AtlasBackups\mastery-engine'
)
if (-not $resolvedBackupRoot.StartsWith(
    $expectedBackupRoot,
    [System.StringComparison]::OrdinalIgnoreCase
  )) {
  throw "BackupRoot must stay inside $expectedBackupRoot"
}

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupDirectory = Join-Path $resolvedBackupRoot $timestamp
$archivePath = Join-Path $backupDirectory 'atlas-public.dump'
$schemaPath = Join-Path $backupDirectory 'atlas-public-schema.sql'
$contentsPath = Join-Path $backupDirectory 'atlas-public.contents.txt'
$rehearsalData = Join-Path $backupDirectory 'restore-rehearsal-data'
$rehearsalDatabase = 'atlas_restore_verified'
$databasePassword = Read-DatabasePassword $EnvFile

New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null

$env:PGPASSWORD = $databasePassword
$env:PGSSLMODE = 'require'
try {
  # The pooler login contains the linked project ref; PostgreSQL maps it to postgres.
  $identity = & (Join-Path $PostgresBin 'psql.exe') `
    --host $sourceHost --port $sourcePort --username $sourceUser `
    --dbname $sourceDatabase --no-password --tuples-only --no-align `
    --command 'select current_user;'
  Assert-LastExitCode 'Source identity check'
  if ($identity.Trim() -ne 'postgres') {
    throw 'Connected database did not return the expected PostgreSQL role.'
  }

  # pg_dump reads a transactionally consistent snapshot; it does not mutate source data.
  & (Join-Path $PostgresBin 'pg_dump.exe') `
    --host $sourceHost --port $sourcePort --username $sourceUser `
    --dbname $sourceDatabase --no-password --schema public `
    --no-owner --no-privileges --format custom --compress 9 `
    --file $archivePath
  Assert-LastExitCode 'Public-schema backup'
} finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:PGSSLMODE -ErrorAction SilentlyContinue
  $databasePassword = $null
}

# Validate the archive and derive a readable schema without reconnecting.
& (Join-Path $PostgresBin 'pg_restore.exe') --list $archivePath |
  Set-Content -LiteralPath $contentsPath -Encoding utf8
Assert-LastExitCode 'Archive list validation'
& (Join-Path $PostgresBin 'pg_restore.exe') --schema-only --no-owner `
  --no-privileges --file $schemaPath $archivePath
Assert-LastExitCode 'Readable schema extraction'

# Restore into a temporary local cluster. It is stopped but retained afterward.
$port = Get-FreeLocalPort
New-Item -ItemType Directory -Path $rehearsalData | Out-Null
$serverStarted = $false
try {
  & (Join-Path $PostgresBin 'initdb.exe') --pgdata $rehearsalData `
    --username postgres --auth trust --encoding UTF8 --no-locale
  Assert-LastExitCode 'Local cluster initialization'

  & (Join-Path $PostgresBin 'pg_ctl.exe') --pgdata $rehearsalData `
    --options "-h 127.0.0.1 -p $port" --wait start
  Assert-LastExitCode 'Local cluster start'
  $serverStarted = $true

  & (Join-Path $PostgresBin 'createdb.exe') --host 127.0.0.1 --port $port `
    --username postgres $rehearsalDatabase
  Assert-LastExitCode 'Rehearsal database creation'

  $localConnection = @(
    '--host', '127.0.0.1', '--port', "$port", '--username', 'postgres',
    '--dbname', $rehearsalDatabase, '--no-password', '--set', 'ON_ERROR_STOP=1'
  )
  $psql = Join-Path $PostgresBin 'psql.exe'

  # The auth objects are minimal stand-ins needed to exercise Supabase foreign keys.
  & $psql @localConnection --command @'
DROP SCHEMA public;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS 'SELECT NULL::uuid';
'@
  Assert-LastExitCode 'Local Supabase stand-in preparation'

  foreach ($section in @('pre-data', 'data')) {
    & (Join-Path $PostgresBin 'pg_restore.exe') --host 127.0.0.1 `
      --port $port --username postgres --dbname $rehearsalDatabase `
      --no-password --no-owner --no-privileges --exit-on-error `
      --section $section $archivePath
    Assert-LastExitCode "$section restore"
  }

  # Add referenced test identities before applying public foreign keys.
  & $psql @localConnection --command @'
INSERT INTO auth.users(id)
SELECT user_id FROM public.papers
UNION SELECT user_id FROM public.questions
UNION SELECT user_id FROM public.sessions
UNION SELECT user_id FROM public.token_logs
UNION SELECT user_id FROM public.exam_simulations
UNION SELECT user_id FROM public.exam_simulation_answers
UNION SELECT user_id FROM public.exam_simulation_marking_results
UNION SELECT user_id FROM public.user_entitlements
ON CONFLICT DO NOTHING;
'@
  Assert-LastExitCode 'Local Auth stand-in seeding'

  & (Join-Path $PostgresBin 'pg_restore.exe') --host 127.0.0.1 `
    --port $port --username postgres --dbname $rehearsalDatabase `
    --no-password --no-owner --no-privileges --exit-on-error `
    --section post-data $archivePath
  Assert-LastExitCode 'post-data restore'

  & $psql @localConnection --tuples-only --no-align --command @'
SELECT 'tables|' || count(*)
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
SELECT 'foreign_keys|' || count(*)
FROM pg_constraint c
JOIN pg_namespace n ON n.oid = c.connamespace
WHERE n.nspname = 'public' AND c.contype = 'f';
SELECT 'rls_tables|' || count(*)
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relrowsecurity;
SELECT 'policies|' || count(*) FROM pg_policies WHERE schemaname = 'public';
'@
  Assert-LastExitCode 'Restore integrity checks'

  Get-FileHash -Algorithm SHA256 -LiteralPath $archivePath, $schemaPath |
    ForEach-Object { Write-Output "$($_.Path)|$($_.Hash)" }
  Write-Output "restore-rehearsal|PASS|$backupDirectory"
} finally {
  if ($serverStarted) {
    & (Join-Path $PostgresBin 'pg_ctl.exe') --pgdata $rehearsalData `
      --wait --mode fast stop
  }
}
