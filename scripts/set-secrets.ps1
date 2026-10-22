$ErrorActionPreference = "Stop"

function Set-WorkerSecret {
    param([Parameter(Mandatory = $true)][string]$Name)

    $secure = Read-Host "Enter $Name" -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    $plainText = $null
    try {
        $plainText = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
        $startInfo = [Diagnostics.ProcessStartInfo]::new()
        $startInfo.FileName = $env:ComSpec
        $startInfo.Arguments = '/d /s /c "npx --yes wrangler secret put ' + $Name + ' --config order-worker/wrangler.toml"'
        $startInfo.UseShellExecute = $false
        $startInfo.RedirectStandardInput = $true
        $startInfo.RedirectStandardOutput = $true
        $startInfo.RedirectStandardError = $true
        $process = [Diagnostics.Process]::new()
        $process.StartInfo = $startInfo
        if (-not $process.Start()) { throw "Could not start Wrangler for $Name." }
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        $process.StandardInput.WriteLine($plainText)
        $process.StandardInput.Close()
        $process.WaitForExit()
        $null = $stdoutTask.GetAwaiter().GetResult()
        $null = $stderrTask.GetAwaiter().GetResult()
        if ($process.ExitCode -ne 0) {
            throw "Wrangler failed while setting $Name (exit $($process.ExitCode))."
        }
        Write-Host "$Name saved to the Worker."
    }
    finally {
        if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
        $plainText = $null
        $secure.Dispose()
    }
}

$secretNames = @(
    "SHEETS_WEB_APP_URL",
    "SHEETS_WEBHOOK_SECRET",
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_CHAT_ID",
    "ADMIN_EMAIL",
    "ADMIN_PASSWORD_HASH",
    "SESSION_SECRET",
    "GITHUB_TOKEN"
)
foreach ($secretName in $secretNames) { Set-WorkerSecret -Name $secretName }
