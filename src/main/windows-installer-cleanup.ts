import path from 'node:path';

const CLEANUP_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$installerPath = $env:SERPENT_UPDATE_CLEANUP_INSTALLER
$installerDirectory = $env:SERPENT_UPDATE_CLEANUP_DIRECTORY
$installerProcessName = [System.IO.Path]::GetFileNameWithoutExtension($installerPath)
$installerProcessId = 0
[void][int]::TryParse($env:SERPENT_UPDATE_CLEANUP_PID, [ref]$installerProcessId)

if ($installerProcessId -gt 0) {
  for ($attempt = 0; $attempt -lt 1800; $attempt++) {
    $installerStillRunning = $false
    $processes = @(Get-Process -Name $installerProcessName -ErrorAction SilentlyContinue)
    foreach ($installerProcess in $processes) {
      $runningPath = $null
      try { $runningPath = $installerProcess.Path } catch { }
      if ($null -eq $runningPath) {
        if ($installerProcess.Id -eq $installerProcessId) {
          $installerStillRunning = $true
          break
        }
        continue
      }
      if ([string]::Equals(
        $runningPath,
        $installerPath,
        [System.StringComparison]::OrdinalIgnoreCase
      )) {
        $installerStillRunning = $true
        break
      }
    }
    if (-not $installerStillRunning) { break }
    Start-Sleep -Milliseconds 500
  }
}

for ($attempt = 0; $attempt -lt 60; $attempt++) {
  try {
    if (Test-Path -LiteralPath $installerPath) {
      Remove-Item -LiteralPath $installerPath -Force -ErrorAction Stop
    }
    if (Test-Path -LiteralPath $installerDirectory) {
      Remove-Item -LiteralPath $installerDirectory -Force -Recurse -ErrorAction Stop
    }
    exit 0
  } catch {
    Start-Sleep -Milliseconds 500
  }
}

$logPath = $env:SERPENT_UPDATE_CLEANUP_LOG
if (-not [string]::IsNullOrWhiteSpace($logPath)) {
  $entry = @{
    timestamp = [DateTime]::UtcNow.ToString('o')
    level = 'error'
    scope = 'app-update.cleanup'
    error = @{
      name = 'CleanupTimeout'
      message = 'The temporary Windows installer could not be removed after retrying.'
    }
    context = @{ artifactKind = 'windows-installer-cleanup' }
  } | ConvertTo-Json -Compress -Depth 5
  try {
    [System.IO.File]::AppendAllText(
      $logPath,
      $entry + [Environment]::NewLine,
      [System.Text.UTF8Encoding]::new($false)
    )
  } catch { }
}
exit 1
`;

export type WindowsInstallerCleanupInvocation = {
  executable: string;
  args: string[];
  env: NodeJS.ProcessEnv;
};

export function createWindowsInstallerCleanupInvocation(input: {
  installerPath: string;
  installerPid?: number;
  logPath?: string;
  environment?: NodeJS.ProcessEnv;
}): WindowsInstallerCleanupInvocation {
  const systemRoot = input.environment?.SystemRoot ?? process.env.SystemRoot;
  const executable = systemRoot === undefined
    ? 'powershell.exe'
    : path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const encodedScript = Buffer.from(CLEANUP_SCRIPT, 'utf16le').toString('base64');

  return {
    executable,
    args: [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-WindowStyle',
      'Hidden',
      '-ExecutionPolicy',
      'Bypass',
      '-EncodedCommand',
      encodedScript,
    ],
    env: {
      ...(input.environment ?? process.env),
      SERPENT_UPDATE_CLEANUP_INSTALLER: input.installerPath,
      SERPENT_UPDATE_CLEANUP_DIRECTORY: path.win32.dirname(input.installerPath),
      SERPENT_UPDATE_CLEANUP_PID: input.installerPid === undefined
        ? ''
        : String(input.installerPid),
      SERPENT_UPDATE_CLEANUP_LOG: input.logPath ?? '',
    },
  };
}
