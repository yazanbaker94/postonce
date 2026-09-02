[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateScript({ Test-Path -LiteralPath $_ -PathType Leaf })]
  [string]$ArchivePath,

  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9a-f]{40}$')]
  [string]$ReleaseId,

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

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$preflightPath = Join-Path $scriptRoot 'preflight-vps.sh'
$deployPath = Join-Path $scriptRoot 'deploy-release.sh'
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

try {
  & scp.exe @connectionArgs $archive "${target}:$remoteArchive"
  if ($LASTEXITCODE -ne 0) {
    throw 'The verified release archive could not be uploaded.'
  }

  $preflightBase64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($preflightPath))
  $preflightBase64 | & ssh.exe @connectionArgs $target 'base64 -d | POSTONCE_HOST_CADDY_ENV_FILE=/etc/rook/caddy.env sh -s'
  if ($LASTEXITCODE -ne 0) {
    throw 'The read-only VPS preflight did not pass. No deployment was started.'
  }

  $deployBase64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($deployPath))
  $remoteDeploy = "base64 -d | POSTONCE_HOST_CADDY_ENV_FILE=/etc/rook/caddy.env sh -s -- '$remoteArchive' '$ReleaseId'"
  $deployBase64 | & ssh.exe @connectionArgs $target $remoteDeploy
  if ($LASTEXITCODE -ne 0) {
    throw 'The PostOnce release did not become healthy.'
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

Write-Output 'PostOnce origin deployment completed with strict host-key verification.'
