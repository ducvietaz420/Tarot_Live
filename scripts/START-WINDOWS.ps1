param([switch]$NoBrowser, [switch]$KeepAlive)
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $projectRoot

try {
    $taskPort = 3210
    if ($env:PORT -match '^\d+$') { $taskPort = [int]$env:PORT }
    $envFile = Join-Path $projectRoot 'backend\.env'
    if (-not $env:PORT -and (Test-Path -LiteralPath $envFile)) {
        foreach ($line in Get-Content -LiteralPath $envFile) {
            if ($line -match '^\s*PORT\s*=\s*["'']?(\d+)["'']?\s*(?:#.*)?$') { $taskPort = [int]$Matches[1] }
        }
    }
    if ($taskPort -lt 1024 -or $taskPort -gt 65535) { throw 'PORT cần nằm trong 1024–65535.' }
    $baseUrl = 'http://127.0.0.1:' + $taskPort

    function Test-TarotServer {
        try {
            $state = Invoke-RestMethod -Uri ($baseUrl + '/api/state?mode=demo') -TimeoutSec 2
            return ($state.mode -eq 'demo' -and $null -ne $state.session -and $null -ne $state.config -and $null -ne $state.capabilities)
        } catch { return $false }
    }

    if (Test-TarotServer) {
        Write-Host ('Tiệm Tarot đã chạy tại ' + $baseUrl + '. Mở lại admin, giữ nguyên phiên hiện có.')
        if (-not $NoBrowser) { Start-Process ($baseUrl + '/admin') }
        exit 0
    }
    $portProbe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $taskPort)
    try { $portProbe.Start() }
    catch { throw ('Cổng ' + $taskPort + ' đang được sử dụng. Không dừng tiến trình đó. Đổi PORT trong backend/.env rồi thử lại.') }
    finally { $portProbe.Stop() }

    . (Join-Path $PSScriptRoot 'SETUP-WINDOWS.ps1')
    $runtime = Get-TarotNodeRuntime -ProjectRoot $projectRoot
    $env:Path = (Split-Path -Parent $runtime.NodePath) + [IO.Path]::PathSeparator + $env:Path
    Install-TarotDependencies -ProjectRoot $projectRoot -NpmPath $runtime.NpmPath
    $tsxCli = Join-Path $projectRoot 'node_modules\tsx\dist\cli.mjs'
    Write-Host 'Đang kiểm tra TypeScript và dựng bản chạy local…'
    & $runtime.NpmPath run build
    if ($LASTEXITCODE -ne 0) { throw 'Build chưa thành công. Xem lỗi ở trên; ứng dụng chưa được khởi động.' }

    $logDir = Join-Path $projectRoot 'data'
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    $serverPath = Join-Path $projectRoot 'server\index.ts'
    $stdoutPath = Join-Path $logDir 'startup.stdout.log'
    $stderrPath = Join-Path $logDir 'startup.stderr.log'
    $serverProcess = Start-Process -FilePath $runtime.NodePath -ArgumentList @(('"' + $tsxCli + '"'), ('"' + $serverPath + '"'), '--production') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
    $serverProcess.Id | Set-Content -LiteralPath (Join-Path $logDir 'launcher.pid') -Encoding ascii
    $ready = $false
    for ($attempt = 0; $attempt -lt 35; $attempt++) {
        if (Test-TarotServer) { $ready = $true; break }
        if ($serverProcess.HasExited) { break }
        Start-Sleep -Milliseconds 400
    }
    if (-not $ready) { throw ('Chưa mở được ứng dụng. Xem data\startup.stderr.log và data\startup.stdout.log. Không dừng tiến trình đang dùng cổng khác.') }
    Write-Host ('Tiệm Tarot đã sẵn sàng: ' + $baseUrl + '/admin')
    Write-Host ('PID backend: ' + $serverProcess.Id + '. Có thể dừng đúng PID này trong Task Manager khi cần.')
    if (-not $NoBrowser) { Start-Process ($baseUrl + '/admin') }
    if ($KeepAlive) {
        Write-Host 'Giữ cửa sổ này mở trong khi dùng Tiệm Tarot.'
        $serverProcess.WaitForExit()
        exit $serverProcess.ExitCode
    }
} catch {
    Write-Host ('Lỗi: ' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
