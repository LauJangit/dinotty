param(
  [int]$TimeoutSeconds = 20
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Get-FreeLoopbackPort {
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
  $listener.Start()
  try {
    return ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
  } finally {
    $listener.Stop()
  }
}

function Test-IsChildPath {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Parent
  )

  $fullPath = [System.IO.Path]::GetFullPath($Path).TrimEnd('\', '/')
  $fullParent = [System.IO.Path]::GetFullPath($Parent).TrimEnd('\', '/')
  $parentWithSep = "$fullParent$([System.IO.Path]::DirectorySeparatorChar)"
  return $fullPath.Equals($fullParent, [System.StringComparison]::OrdinalIgnoreCase) -or
    $fullPath.StartsWith($parentWithSep, [System.StringComparison]::OrdinalIgnoreCase)
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$serverExe = Join-Path $repoRoot "target\debug\dinotty-server.exe"
if (-not (Test-Path -LiteralPath $serverExe)) {
  throw "server binary not found: $serverExe. Run cargo build --bin dinotty-server first."
}

$port = Get-FreeLoopbackPort
$tempRoot = $env:RUNNER_TEMP
if ([string]::IsNullOrWhiteSpace($tempRoot)) {
  $tempRoot = [System.IO.Path]::GetTempPath()
}
$tmp = Join-Path $tempRoot "dinotty-smoke-$port"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

$env:APPDATA = Join-Path $tmp "AppData\Roaming"
$env:LOCALAPPDATA = Join-Path $tmp "AppData\Local"
$env:USERPROFILE = Join-Path $tmp "User"
$env:DINOTTY_TOKEN = "smoke-token"
New-Item -ItemType Directory -Force -Path $env:APPDATA, $env:LOCALAPPDATA, $env:USERPROFILE |
  Out-Null

$stdout = Join-Path $tmp "server.out.log"
$stderr = Join-Path $tmp "server.err.log"
$proc = $null

try {
  $proc = Start-Process `
    -FilePath $serverExe `
    -ArgumentList "--port", $port `
    -WorkingDirectory $repoRoot `
    -PassThru `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdout `
    -RedirectStandardError $stderr

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $ready = $false
  $info = $null
  do {
    if ($proc.HasExited) {
      throw "server exited early with code $($proc.ExitCode)"
    }
    try {
      $info = Invoke-RestMethod "http://127.0.0.1:$port/api/info"
      $ready = $true
    } catch {
      Start-Sleep -Milliseconds 500
    }
  } until ($ready -or (Get-Date) -gt $deadline)

  if (-not $ready) {
    throw "server did not become ready within $TimeoutSeconds seconds"
  }
  if ([int]$info.port -ne $port) {
    throw "unexpected /api/info port: $($info.port)"
  }

  $index = Invoke-WebRequest "http://127.0.0.1:$port/" -UseBasicParsing
  if ($index.StatusCode -ne 200 -or $index.Content -notmatch 'id="app"') {
    throw "index smoke check failed"
  }

  $settings = Invoke-RestMethod "http://127.0.0.1:$port/api/settings"
  if ($null -eq $settings.theme) {
    throw "settings smoke check failed"
  }

  Write-Host "Windows smoke test passed on http://127.0.0.1:$port"
} catch {
  if (Test-Path -LiteralPath $stderr) {
    Write-Host "--- server stderr ---"
    Get-Content -LiteralPath $stderr
  }
  if (Test-Path -LiteralPath $stdout) {
    Write-Host "--- server stdout ---"
    Get-Content -LiteralPath $stdout
  }
  throw
} finally {
  if ($proc -and -not $proc.HasExited) {
    Stop-Process -Id $proc.Id -Force
  }
  if ((Test-Path -LiteralPath $tmp) -and (Test-IsChildPath -Path $tmp -Parent $tempRoot)) {
    Remove-Item -LiteralPath $tmp -Recurse -Force
  }
}
