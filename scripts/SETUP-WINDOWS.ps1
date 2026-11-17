function Test-TarotNodeRuntime {
    param([string]$NodePath, [string]$NpmPath)
    if (-not $NodePath -or -not $NpmPath) { return $false }
    if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf) -or -not (Test-Path -LiteralPath $NpmPath -PathType Leaf)) { return $false }
    $previousPath = $env:Path
    try {
        $version = & $NodePath --version 2>$null
        if ($LASTEXITCODE -ne 0 -or $version -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 24) { return $false }
        $env:Path = (Split-Path -Parent $NodePath) + [IO.Path]::PathSeparator + $previousPath
        $npmVersion = & $NpmPath --version 2>$null
        return ($LASTEXITCODE -eq 0 -and $npmVersion -match '^\d+\.\d+\.\d+')
    } catch { return $false }
    finally { $env:Path = $previousPath }
}

function Get-TarotNodeRuntime {
    param([Parameter(Mandatory = $true)][string]$ProjectRoot)
    $runtimeRoot = Join-Path $ProjectRoot '.runtime'
    $portableRoot = Join-Path $runtimeRoot 'node'
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if ($nodeCommand -and $npmCommand -and (Test-TarotNodeRuntime $nodeCommand.Source $npmCommand.Source)) {
        return @{ NodePath = $nodeCommand.Source; NpmPath = $npmCommand.Source }
    }
    $portableNode = Join-Path $portableRoot 'node.exe'
    $portableNpm = Join-Path $portableRoot 'npm.cmd'
    if (Test-TarotNodeRuntime $portableNode $portableNpm) {
        return @{ NodePath = $portableNode; NpmPath = $portableNpm }
    }

    Write-Host 'Chưa có Node.js 24+/npm phù hợp. Đang tải Node.js kèm npm vào project…'
    $architecture = $env:PROCESSOR_ARCHITEW6432
    if (-not $architecture) { $architecture = $env:PROCESSOR_ARCHITECTURE }
    switch ($architecture) {
        'AMD64' { $architecture = 'x64' }
        'ARM64' { $architecture = 'arm64' }
        default { throw 'Cần Windows 64-bit (x64 hoặc ARM64) để tự cài Node.js 24 và npm.' }
    }
    New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
    $runtimeRoot = (Resolve-Path -LiteralPath $runtimeRoot).Path
    $stagingRoot = Join-Path $runtimeRoot ('setup-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $stagingRoot | Out-Null
    $previousProgress = $ProgressPreference
    try {
        $ProgressPreference = 'SilentlyContinue'
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        $manifest = Invoke-WebRequest -UseBasicParsing -Uri 'https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt' -TimeoutSec 120
        $release = $null
        foreach ($line in ($manifest.Content -split '\r?\n')) {
            if ($line.Trim() -match ('^([a-fA-F0-9]{64})\s+(node-(v24\.\d+\.\d+)-win-' + $architecture + '\.zip)$')) {
                $release = @{ Hash = $Matches[1]; FileName = $Matches[2]; Version = $Matches[3] }
                break
            }
        }
        if (-not $release) { throw 'Không tìm thấy bản Node.js 24 dành cho Windows này.' }
        $archivePath = Join-Path $stagingRoot $release.FileName
        $archiveUrl = 'https://nodejs.org/dist/' + $release.Version + '/' + $release.FileName
        Invoke-WebRequest -UseBasicParsing -Uri $archiveUrl -OutFile $archivePath -TimeoutSec 300
        if ((Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash -ne $release.Hash) {
            throw 'File Node.js tải về không khớp SHA-256. Hãy chạy lại launcher để tải lại.'
        }
        Expand-Archive -LiteralPath $archivePath -DestinationPath $stagingRoot
        $extractedRoot = Join-Path $stagingRoot ([IO.Path]::GetFileNameWithoutExtension($release.FileName))
        if (-not (Test-TarotNodeRuntime (Join-Path $extractedRoot 'node.exe') (Join-Path $extractedRoot 'npm.cmd'))) {
            throw 'Không chạy được Node.js/npm vừa tải về.'
        }
        if (Test-Path -LiteralPath $portableRoot) {
            Move-Item -LiteralPath $portableRoot -Destination (Join-Path $stagingRoot 'previous-node')
        }
        Move-Item -LiteralPath $extractedRoot -Destination $portableRoot
        Write-Host 'Đã cài Node.js và npm vào .runtime\node.'
        return @{ NodePath = $portableNode; NpmPath = $portableNpm }
    } catch {
        throw ('Không thể tự cài Node.js/npm: ' + $_.Exception.Message + ' Kiểm tra kết nối mạng rồi chạy lại START.bat.')
    } finally {
        $ProgressPreference = $previousProgress
        $resolvedStaging = (Resolve-Path -LiteralPath $stagingRoot -ErrorAction SilentlyContinue).Path
        if ($resolvedStaging -and $resolvedStaging.StartsWith($runtimeRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
            Remove-Item -LiteralPath $resolvedStaging -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

function Test-TarotDependencies {
    param([Parameter(Mandatory = $true)][string]$ProjectRoot)
    $package = Get-Content -LiteralPath (Join-Path $ProjectRoot 'package.json') -Raw | ConvertFrom-Json
    foreach ($group in @($package.dependencies, $package.devDependencies)) {
        if ($null -eq $group) { continue }
        foreach ($name in $group.PSObject.Properties.Name) {
            if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot ('node_modules\' + $name + '\package.json')) -PathType Leaf)) { return $false }
        }
    }
    foreach ($cli in @('tsx\dist\cli.mjs', 'typescript\bin\tsc', 'vite\bin\vite.js')) {
        if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot ('node_modules\' + $cli)) -PathType Leaf)) { return $false }
    }
    return $true
}

function Install-TarotDependencies {
    param([Parameter(Mandatory = $true)][string]$ProjectRoot, [Parameter(Mandatory = $true)][string]$NpmPath)
    if (Test-TarotDependencies $ProjectRoot) { return }
    Write-Host 'Chưa đủ dependency. Đang tự động chạy npm install, vui lòng chờ…'
    Push-Location -LiteralPath $ProjectRoot
    try {
        & $NpmPath install --include=dev | Out-Host
        if ($LASTEXITCODE -ne 0) { throw ('npm install thất bại (mã lỗi ' + $LASTEXITCODE + '). Kiểm tra lỗi ở trên và kết nối mạng rồi chạy lại START.bat.') }
        if (-not (Test-TarotDependencies $ProjectRoot)) { throw 'npm install đã kết thúc nhưng vẫn thiếu dependency. Xem thông báo npm ở trên rồi chạy lại START.bat.' }
    } finally { Pop-Location }
}
