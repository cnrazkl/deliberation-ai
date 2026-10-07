# Opt-in Windows lifecycle check. Stop the managed app safely before running it.
# The started owner app remains running; only the generated launcher's job closes.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$taskNode = (Get-Command node -ErrorAction Stop).Source
$taskIdentity = [guid]::NewGuid().ToString()
$taskOutput = Join-Path $taskRoot ('.local/runtime/job-probe-' + $taskIdentity + '.log')
$taskComplete = Join-Path $taskRoot ('.local/runtime/job-probe-' + $taskIdentity + '.complete')
$taskNative = @'
using System;
using System.Runtime.InteropServices;
public static class DeliberationRuntimeJob {
 [StructLayout(LayoutKind.Sequential)] public struct Basic {
  public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
  public uint LimitFlags;
  public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
  public uint ActiveProcessLimit;
  public UIntPtr Affinity;
  public uint PriorityClass, SchedulingClass;
 }
 [StructLayout(LayoutKind.Sequential)] public struct IO {
  public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount;
 }
 [StructLayout(LayoutKind.Sequential)] public struct Limits {
  public Basic BasicLimitInformation; public IO IoInfo;
  public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
 }
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern IntPtr CreateJobObject(IntPtr attrs, string name);
 [DllImport("kernel32.dll", SetLastError=true)] public static extern bool SetInformationJobObject(IntPtr job, int info, ref Limits limits, uint length);
 [DllImport("kernel32.dll", SetLastError=true)] public static extern bool QueryInformationJobObject(IntPtr job, int info, ref Limits limits, uint length, out uint returned);
 [DllImport("kernel32.dll", SetLastError=true)] public static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
 [DllImport("kernel32.dll", SetLastError=true)] public static extern bool CloseHandle(IntPtr handle);
}
'@
Add-Type -TypeDefinition $taskNative
$taskJob = [IntPtr]::Zero
$taskLauncher = $null
try {
    if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) { throw 'Stop the app before the lifecycle check.' }
    if (!(Test-Path -LiteralPath (Join-Path $taskRoot '.env.local'))) { throw 'Local configuration required.' }
    New-Item -ItemType Directory -Path (Join-Path $taskRoot '.local/runtime') -Force | Out-Null
    $taskJob = [DeliberationRuntimeJob]::CreateJobObject([IntPtr]::Zero, $null)
    if ($taskJob -eq [IntPtr]::Zero) { throw 'Probe job unavailable.' }
    $taskLimits = [DeliberationRuntimeJob+Limits]::new()
    $taskBasic = [DeliberationRuntimeJob+Basic]::new()
    $taskBasic.LimitFlags = 0x2000 # KILL_ON_JOB_CLOSE; assign the whole value struct.
    $taskLimits.BasicLimitInformation = $taskBasic
    if (![DeliberationRuntimeJob]::SetInformationJobObject($taskJob, 9, [ref]$taskLimits, [Runtime.InteropServices.Marshal]::SizeOf($taskLimits))) { throw 'Probe job limits unavailable.' }
    $taskReadLimits = [DeliberationRuntimeJob+Limits]::new()
    $taskReturned = [uint32]0
    if (![DeliberationRuntimeJob]::QueryInformationJobObject($taskJob, 9, [ref]$taskReadLimits, [Runtime.InteropServices.Marshal]::SizeOf($taskReadLimits), [ref]$taskReturned) -or ($taskReadLimits.BasicLimitInformation.LimitFlags -band 0x2000) -eq 0) { throw 'Probe kill-on-close policy was not applied.' }
    function Literal([string]$value) { return "'" + $value.Replace("'", "''") + "'" }
    $taskCode = 'Start-Sleep -Milliseconds 1500; Set-Location -LiteralPath ' + (Literal $taskRoot) + '; & ' + (Literal $taskNode) + ' ' + (Literal (Join-Path $taskRoot 'node_modules/tsx/dist/cli.mjs')) + ' ' + (Literal (Join-Path $taskRoot 'packages/persistence/scripts/local-runtime.ts')) + ' start *> ' + (Literal $taskOutput) + '; if ($LASTEXITCODE -ne 0) { exit 1 }; Set-Content -LiteralPath ' + (Literal $taskComplete) + ' -Value ready; Start-Sleep -Seconds 300'
    $taskEncoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($taskCode))
    $taskLauncher = Start-Process -FilePath powershell.exe -ArgumentList @('-NoProfile', '-NonInteractive', '-EncodedCommand', $taskEncoded) -WindowStyle Hidden -PassThru
    if (![DeliberationRuntimeJob]::AssignProcessToJobObject($taskJob, $taskLauncher.Handle)) { throw 'Probe launcher could not join its disposable job.' }
    $taskDeadline = (Get-Date).AddSeconds(140)
    while (!(Test-Path -LiteralPath $taskComplete)) {
        if ($taskLauncher.HasExited -or (Get-Date) -gt $taskDeadline) { throw 'Probe launcher failed or timed out.' }
        Start-Sleep -Milliseconds 500
    }
    $taskRecord = Get-Content -LiteralPath (Join-Path $taskRoot '.local/runtime/managed.json') | ConvertFrom-Json
    if (![DeliberationRuntimeJob]::CloseHandle($taskJob)) { throw 'Probe job closure failed.' }
    $taskJob = [IntPtr]::Zero
    if (!$taskLauncher.WaitForExit(5000)) { throw 'Probe launcher survived its job closure.' }
    # Check once after teardown and again after heartbeat/server activity.
    foreach ($taskDelay in @(2, 12)) {
        Start-Sleep -Seconds $taskDelay
        $taskPage = Invoke-WebRequest http://127.0.0.1:3000/ -UseBasicParsing -TimeoutSec 10
        $taskDiagnostics = Invoke-RestMethod http://127.0.0.1:3000/api/local-diagnostics -TimeoutSec 10
        if ($taskPage.StatusCode -ne 200 -or $taskDiagnostics.database -ne 'ready' -or $taskDiagnostics.readyWorkers -ne 1 -or $taskDiagnostics.operational.runtimeIdentity -ne $taskRecord.identity) { throw 'Runtime did not survive launcher job teardown.' }
    }
    $taskProof = @{ version='local-session-job-proof-v1'; at=[DateTime]::UtcNow.ToString('o'); launcherExited=$true; jobClosed=$true; http=200; database='ready'; readyWorkers=1; identity=$taskRecord.identity }
    $taskProof | ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $taskRoot '.local/runtime/job-teardown-proof.json')
    Write-Output 'Runtime survived forced launcher/job teardown; HTTP 200, database and one worker ready.'
} finally {
    if ($taskJob -ne [IntPtr]::Zero) { [DeliberationRuntimeJob]::CloseHandle($taskJob) | Out-Null }
    if ($taskLauncher -and !$taskLauncher.HasExited) { $taskLauncher.Kill(); $taskLauncher.WaitForExit() }
}
