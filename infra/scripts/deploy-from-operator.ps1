[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateScript({ Test-Path -LiteralPath $_ -PathType Leaf })]
  [string]$ArchivePath,

  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9a-f]{40}$')]
  [string]$ReleaseId,

  [ValidatePattern('^[0-9a-f]{40}$')]
  [string]$ReplaceFailedReleaseId,

  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[A-Za-z0-9.-]+$')]
  [string]$HostName,

  [ValidatePattern('^[A-Za-z_][A-Za-z0-9_-]*$')]
  [string]$UserName = 'root',

  [Parameter(Mandatory = $true)]
  [ValidateScript({ Test-Path -LiteralPath $_ -PathType Leaf })]
  [string]$IdentityPath,

  [ValidateScript({ Test-Path -LiteralPath $_ -PathType Leaf })]
  [string]$KnownHostsPath = (Join-Path $env:USERPROFILE '.ssh\known_hosts')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$archive = (Resolve-Path -LiteralPath $ArchivePath).Path
$identity = (Resolve-Path -LiteralPath $IdentityPath).Path
$knownHosts = (Resolve-Path -LiteralPath $KnownHostsPath).Path
$checksumPath = "$archive.sha256"
if (-not (Test-Path -LiteralPath $checksumPath -PathType Leaf)) {
  throw 'The release checksum sidecar is required.'
}

$expectedHash = ((Get-Content -LiteralPath $checksumPath -Raw).Trim() -split '\s+')[0].ToLowerInvariant()
if ($expectedHash -notmatch '^[0-9a-f]{64}$') {
  throw 'The release checksum sidecar is not valid.'
}
$actualHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualHash -ne $expectedHash) {
  throw 'The operations archive does not match its SHA-256 checksum.'
}

$tarCommand = Get-Command tar.exe -ErrorAction SilentlyContinue
if ($null -eq $tarCommand) {
  throw 'tar.exe is required to read the verified operations artifact.'
}

function Read-ArchiveTextEntry {
  param(
    [Parameter(Mandatory = $true)]
    [string]$EntryName
  )

  $entryLines = & $tarCommand.Source -xOf $archive $EntryName
  if ($LASTEXITCODE -ne 0 -or $null -eq $entryLines) {
    throw "The verified operations artifact is missing $EntryName."
  }
  return (($entryLines -join "`n") + "`n")
}

function Read-ManifestValue {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Manifest,

    [Parameter(Mandatory = $true)]
    [string]$Key
  )

  $pattern = '(?m)^' + [Regex]::Escape($Key) + '=([^\r\n]+)$'
  $matches = [Regex]::Matches($Manifest, $pattern)
  if ($matches.Count -ne 1) {
    throw "The release manifest must contain exactly one $Key value."
  }
  return $matches[0].Groups[1].Value
}

function Invoke-PublicCheck {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Uri,

    [ValidateRange(1, 20)]
    [int]$Attempts = 1
  )

  $lastError = $null
  for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
    try {
      return Invoke-WebRequest -Uri $Uri -Method Get -MaximumRedirection 3 -TimeoutSec 15
    }
    catch {
      $lastError = $_
      if ($attempt -lt $Attempts) {
        Start-Sleep -Seconds 5
      }
    }
  }
  throw "Public verification failed for $Uri after $Attempts attempts: $($lastError.Exception.Message)"
}

# Execute the preflight and deployment scripts carried by the checksummed
# artifact, never similarly named files from an arbitrary local checkout.
$manifestText = Read-ArchiveTextEntry -EntryName 'release-manifest.env'
$artifactRevision = Read-ManifestValue -Manifest $manifestText -Key 'SOURCE_REVISION'
$artifactRepository = Read-ManifestValue -Manifest $manifestText -Key 'SOURCE_REPOSITORY'
$artifactApiImage = Read-ManifestValue -Manifest $manifestText -Key 'POSTONCE_API_IMAGE'
$artifactGatewayImage = Read-ManifestValue -Manifest $manifestText -Key 'POSTONCE_GATEWAY_IMAGE'
if ($artifactRevision -ne $ReleaseId) {
  throw 'The requested release id does not match the verified artifact commit.'
}
if ($artifactRepository -ne 'yazanbaker94/postonce') {
  throw 'The verified artifact was not built from the approved PostOnce repository.'
}
if ($artifactApiImage -notmatch '^ghcr\.io/yazanbaker94/postonce-api@sha256:[0-9a-f]{64}$' -or
    $artifactGatewayImage -notmatch '^ghcr\.io/yazanbaker94/postonce-gateway@sha256:[0-9a-f]{64}$') {
  throw 'The verified artifact does not contain approved immutable PostOnce image references.'
}
$preflightScript = Read-ArchiveTextEntry -EntryName 'infra/scripts/preflight-vps.sh'
$deployScript = Read-ArchiveTextEntry -EntryName 'infra/scripts/deploy-release.sh'
$destroyScript = if ($ReplaceFailedReleaseId) {
  Read-ArchiveTextEntry -EntryName 'infra/scripts/destroy-failed-postonce.sh'
} else {
  $null
}

$remoteArchive = "/tmp/postonce-operations-$ReleaseId.tgz"
$target = "${UserName}@${HostName}"
$connectionArgs = @(
  '-i', $identity,
  '-o', 'BatchMode=yes',
  '-o', 'IdentitiesOnly=yes',
  '-o', 'StrictHostKeyChecking=yes',
  '-o', "UserKnownHostsFile=$knownHosts",
  '-o', 'ConnectTimeout=15'
)

$audioFetcherBeforeResponse = Invoke-PublicCheck -Uri 'https://audiofetcher.com/health' -Attempts 3
$audioFetcherBefore = $audioFetcherBeforeResponse.Content | ConvertFrom-Json
if ($audioFetcherBefore.ok -ne $true -or -not $audioFetcherBefore.release_id) {
  throw 'AudioFetcher public health is not ready; PostOnce deployment was not started.'
}

try {
  & scp.exe @connectionArgs $archive "${target}:$remoteArchive"
  if ($LASTEXITCODE -ne 0) {
    throw 'The verified release archive could not be uploaded.'
  }

  $preflightBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($preflightScript))
  $preflightBase64 | & ssh.exe @connectionArgs $target 'base64 -d | POSTONCE_HOST_CADDY_ENV_FILE=/etc/rook/caddy.env sh -s'
  if ($LASTEXITCODE -ne 0) {
    throw 'The read-only VPS preflight did not pass. No deployment was started.'
  }

  if ($ReplaceFailedReleaseId) {
    $destroyBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($destroyScript))
    $remoteDestroy = "base64 -d | POSTONCE_HOST_CADDY_ENV_FILE=/etc/rook/caddy.env sh -s -- '$ReplaceFailedReleaseId' --yes"
    $destroyBase64 | & ssh.exe @connectionArgs $target $remoteDestroy
    if ($LASTEXITCODE -ne 0) {
      throw 'The explicitly identified failed PostOnce installation was not fully removed.'
    }

    # Revalidate the now-empty boundary before creating a new database and
    # environment. This also proves that the protected AudioFetcher units
    # remained active through the destructive, PostOnce-only reset.
    $preflightBase64 | & ssh.exe @connectionArgs $target 'base64 -d | POSTONCE_HOST_CADDY_ENV_FILE=/etc/rook/caddy.env sh -s'
    if ($LASTEXITCODE -ne 0) {
      throw 'PostOnce was removed, but the clean VPS boundary did not pass preflight.'
    }
  }

  $deployBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($deployScript))
  $remoteDeploy = "base64 -d | POSTONCE_HOST_CADDY_ENV_FILE=/etc/rook/caddy.env sh -s -- '$remoteArchive' '$ReleaseId'"
  $deployBase64 | & ssh.exe @connectionArgs $target $remoteDeploy
  if ($LASTEXITCODE -ne 0) {
    throw 'The PostOnce release did not become healthy.'
  }

  $rootResponse = Invoke-PublicCheck -Uri 'https://postonce.swoop.video/' -Attempts 12
  $gatewayHealthResponse = Invoke-PublicCheck -Uri 'https://postonce.swoop.video/healthz' -Attempts 3
  $apiHealthResponse = Invoke-PublicCheck -Uri 'https://postonce.swoop.video/api/health' -Attempts 3
  $cloudflareServer = ($rootResponse.Headers['Server'] -join ',')
  if ($cloudflareServer -notmatch '(?i)cloudflare') {
    throw 'PostOnce is reachable, but the public response did not traverse the expected Cloudflare proxy.'
  }
  if ($gatewayHealthResponse.StatusCode -ne 200) {
    throw 'The public PostOnce gateway health endpoint is not ready.'
  }
  $apiHealth = $apiHealthResponse.Content | ConvertFrom-Json
  if ($apiHealth.status -ne 'ok' -or $apiHealth.persistence.ok -ne $true -or
      $apiHealth.persistence.mode -ne 'postgres') {
    throw 'The public PostOnce API is not using healthy PostgreSQL persistence.'
  }

  $audioFetcherAfterResponse = Invoke-PublicCheck -Uri 'https://audiofetcher.com/health' -Attempts 3
  $audioFetcherAfter = $audioFetcherAfterResponse.Content | ConvertFrom-Json
  if ($audioFetcherAfter.ok -ne $true -or
      $audioFetcherAfter.release_id -ne $audioFetcherBefore.release_id -or
      $audioFetcherAfter.git_sha -ne $audioFetcherBefore.git_sha) {
    throw 'AudioFetcher changed or became unhealthy during the PostOnce deployment.'
  }
}
finally {
  # The server-side deploy removes this exact file on success. This bounded,
  # idempotent cleanup also prevents a failed preflight from leaving it behind.
  try {
    & ssh.exe @connectionArgs $target "rm -f -- '$remoteArchive'" 2>$null | Out-Null
  }
  catch {
    # Preserve the deployment/preflight result; this is best-effort hygiene.
  }
}

Write-Output 'PostOnce origin, Cloudflare route, PostgreSQL API, and AudioFetcher preservation checks passed.'
