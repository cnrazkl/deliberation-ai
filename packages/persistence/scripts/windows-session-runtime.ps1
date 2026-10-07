[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('start', 'serve', 'status', 'remove')][string]$Action,
    [Parameter(Mandatory)][string]$Root,
    [Parameter(Mandatory)][string]$NodePath,
    [Parameter(Mandatory)][string]$LocalDataRoot
)
$ErrorActionPreference = 'Stop'
$taskPhase = 'paths'
try {
    $Root = [IO.Path]::GetFullPath($Root)
    $scriptRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
    if ($Root -ne $scriptRoot -or !(Test-Path -LiteralPath $NodePath -PathType Leaf) -or !(Test-Path -LiteralPath $LocalDataRoot -PathType Container)) { throw 'Invalid runtime paths.' }
    foreach ($value in @($Root, $NodePath, $LocalDataRoot, $PSCommandPath)) {
        if ($value -match '["\r\n\x00]') { throw 'Invalid runtime argument.' }
    }
    if ($Action -eq 'serve') {
        $env:LOCALAPPDATA = $LocalDataRoot
        Set-Location -LiteralPath $Root
        & $NodePath (Join-Path $Root 'node_modules/tsx/dist/cli.mjs') (Join-Path $Root 'packages/persistence/scripts/local-runtime.ts') serve
        exit $LASTEXITCODE
    }
    $hash = [Security.Cryptography.SHA256]::Create()
    try { $digest = [BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($Root.ToLowerInvariant()))).Replace('-', '').ToLowerInvariant() }
    finally { $hash.Dispose() }
    $taskName = 'DeliberationAI-session-' + $digest.Substring(0, 20)
    $description = 'DeliberationAI owned session runtime v1: ' + $Root
    $execute = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
    # All paths are literal -File values. No credentials/configuration values enter
    # the task definition; the running process reads the existing .env.local.
    $arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -File "' + $PSCommandPath + '" -Action serve -Root "' + $Root + '" -NodePath "' + $NodePath + '" -LocalDataRoot "' + $LocalDataRoot.TrimEnd('\') + '"'
    $owner = [Security.Principal.WindowsIdentity]::GetCurrent()
    $existing = Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction SilentlyContinue
    $taskPhase = 'owned-task-validation'
    if ($existing) {
        # CIM may shorten CANER\caner to caner. The stored XML preserves the SID
        # and avoids ambiguous or unavailable account-name translation.
        $existingXml = [xml](Export-ScheduledTask -TaskName $taskName -TaskPath '\')
        if ($existing.Description -ne $description -or @($existing.Actions).Count -ne 1 -or
            $existing.Actions[0].Execute -ne $execute -or $existing.Actions[0].Arguments -ne $arguments -or
            $existing.Actions[0].WorkingDirectory -ne $Root -or @($existing.Triggers | Where-Object { $null -ne $_ }).Count -ne 0 -or
            $existingXml.Task.Principals.Principal.UserId -ne $owner.User.Value -or
            $existing.Principal.LogonType -ne 'Interactive' -or $existing.Principal.RunLevel -ne 'Limited' -or
            $existing.Settings.MultipleInstances -ne 'IgnoreNew' -or $existing.Settings.ExecutionTimeLimit -ne 'PT0S' -or
            $existing.Settings.RestartCount -ne 0 -or $existing.Settings.DisallowStartIfOnBatteries -or
            $existing.Settings.StopIfGoingOnBatteries -or $existing.Settings.RunOnlyIfIdle) { throw 'Existing task is not the owned launcher.' }
    }
    if ($Action -eq 'status') {
        $lastTaskResult = if ($existing) { (Get-ScheduledTaskInfo -TaskName $taskName -TaskPath '\').LastTaskResult } else { $null }
        @{ taskName=$taskName; registered=[bool]$existing; running=[bool]($existing -and $existing.State -eq 'Running'); lastTaskResult=$lastTaskResult } | ConvertTo-Json -Compress
        exit 0
    }
    if ($Action -eq 'remove') {
        if ($existing -and $existing.State -eq 'Running') { throw 'Stop the runtime before removing its launcher.' }
        if ($existing) { Unregister-ScheduledTask -TaskName $taskName -TaskPath '\' -Confirm:$false }
        @{ taskName=$taskName; registered=$false; running=$false } | ConvertTo-Json -Compress
        exit 0
    }
    if ($existing -and $existing.State -eq 'Running') {
        @{ taskName=$taskName; started=$false; running=$true } | ConvertTo-Json -Compress
        exit 0
    }
    $taskAction = New-ScheduledTaskAction -Execute $execute -Argument $arguments -WorkingDirectory $Root
    $principal = New-ScheduledTaskPrincipal -UserId $owner.Name -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -Hidden
    # On-demand only: no login, reboot, timer or failure-restart trigger.
    $taskPhase = 'registration'
    Register-ScheduledTask -TaskName $taskName -TaskPath '\' -Description $description -Action $taskAction -Principal $principal -Settings $settings -Force | Out-Null
    $taskPhase = 'start'
    Start-ScheduledTask -TaskName $taskName -TaskPath '\'
    @{ taskName=$taskName; started=$true; running=$true } | ConvertTo-Json -Compress
} catch {
    [Console]::Error.WriteLine('Windows session runtime action refused or failed during ' + $taskPhase + '.')
    exit 1
}
