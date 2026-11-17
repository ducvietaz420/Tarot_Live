# Run with Windows PowerShell 5.1; all network and runtime downloads are mocked.
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$setupScript = Join-Path $PSScriptRoot 'SETUP-WINDOWS.ps1'
$fixtureRoot = Join-Path (Join-Path $projectRoot 'tmp') ('windows-setup-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixtureRoot -Force | Out-Null
$savedArchitecture = $env:PROCESSOR_ARCHITECTURE
$savedArchitecture6432 = $env:PROCESSOR_ARCHITEW6432
$script:passed = 0

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}

function Assert-Throws {
    param([scriptblock]$Action, [string]$Pattern)
    $caught = $null
    try { & $Action } catch { $caught = $_.Exception.Message }
    Assert-True ($null -ne $caught) 'Expected an error, but the operation succeeded.'
    Assert-True ($caught -match $Pattern) ('Unexpected error: ' + $caught)
}

function Invoke-SetupCase {
    param([string]$Name, [scriptblock]$Body)
    & $Body
    $script:passed++
    Write-Host ('PASS ' + $Name)
}

function New-Fixture {
    param([string]$Name)
    $root = Join-Path $fixtureRoot $Name
    New-Item -ItemType Directory -Path $root -Force | Out-Null
    return $root
}

function Write-FixtureFile {
    param([string]$Path, [string]$Content = '')
    New-Item -ItemType Directory -Path (Split-Path -Parent $Path) -Force | Out-Null
    [IO.File]::WriteAllText($Path, $Content, [Text.Encoding]::ASCII)
}

function Invoke-BootstrapFixture {
    param([string]$Mode, [string]$Failure = '')
    . $setupScript
    $root = New-Fixture ('bootstrap-' + $Mode + '-' + $Failure)
    $systemRoot = Join-Path $root 'system tools'
    $systemNode = Join-Path $systemRoot 'node.exe'
    $systemNpm = Join-Path $systemRoot 'npm.cmd'
    $portableRoot = Join-Path $root '.runtime\node'
    $expectedHash = 'a' * 64
    $calls = New-Object 'System.Collections.Generic.List[string]'
    if ($Mode -in @('system', 'missing-npm', 'old-node')) {
        $version = if ($Mode -eq 'old-node') { 'v22.0.0' } else { 'v24.1.0' }
        Write-FixtureFile $systemNode $version
        if ($Mode -ne 'missing-npm') { Write-FixtureFile $systemNpm 'npm' }
    }
    if ($Mode -eq 'cached') {
        Write-FixtureFile (Join-Path $portableRoot 'node.exe') 'v24.1.0'
        Write-FixtureFile (Join-Path $portableRoot 'npm.cmd') 'npm'
    }

    function Get-Command {
        param([string]$Name, $ErrorAction)
        if ($Name -eq 'node.exe' -and (Test-Path -LiteralPath $systemNode)) { return [pscustomobject]@{ Source = $systemNode } }
        if ($Name -eq 'npm.cmd' -and (Test-Path -LiteralPath $systemNpm)) { return [pscustomobject]@{ Source = $systemNpm } }
        return $null
    }
    function Test-TarotNodeRuntime {
        param([string]$NodePath, [string]$NpmPath)
        if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf) -or -not (Test-Path -LiteralPath $NpmPath -PathType Leaf)) { return $false }
        return (([IO.File]::ReadAllText($NodePath)) -match '^v24\.')
    }
    function Invoke-WebRequest {
        param([switch]$UseBasicParsing, [string]$Uri, [string]$OutFile, [int]$TimeoutSec)
        $calls.Add($Uri)
        if ($Failure -eq 'download') { throw 'mock download failure' }
        if (-not $OutFile) { return [pscustomobject]@{ Content = ($expectedHash + '  node-v24.99.0-win-x64.zip') } }
        Write-FixtureFile $OutFile 'mock archive'
    }
    function Get-FileHash {
        param([string]$LiteralPath, [string]$Algorithm)
        Assert-True ($Algorithm -eq 'SHA256') 'Runtime download must use SHA256.'
        $hash = if ($Failure -eq 'checksum') { 'b' * 64 } else { $expectedHash }
        return [pscustomobject]@{ Hash = $hash }
    }
    function Expand-Archive {
        param([string]$LiteralPath, [string]$DestinationPath)
        $calls.Add('extract')
        $extractedRoot = Join-Path $DestinationPath 'node-v24.99.0-win-x64'
        Write-FixtureFile (Join-Path $extractedRoot 'node.exe') 'v24.99.0'
        Write-FixtureFile (Join-Path $extractedRoot 'npm.cmd') 'npm'
    }

    if ($Failure) {
        $pattern = if ($Failure -eq 'checksum') { 'SHA-256' } else { 'mock download failure' }
        Assert-Throws { Get-TarotNodeRuntime -ProjectRoot $root } $pattern
        Assert-True (-not (Test-Path -LiteralPath $portableRoot)) 'Failed bootstrap installed a runtime.'
        Assert-True (-not $calls.Contains('extract')) 'Failed download/checksum must not extract or execute the archive.'
    } else {
        $runtime = Get-TarotNodeRuntime -ProjectRoot $root
        Assert-True ($runtime -is [hashtable]) 'Runtime result was polluted with command output.'
        $expectedRoot = if ($Mode -eq 'system') { $systemRoot } else { $portableRoot }
        Assert-True ($runtime.NodePath -eq (Join-Path $expectedRoot 'node.exe')) 'Wrong Node path selected.'
        Assert-True ($runtime.NpmPath -eq (Join-Path $expectedRoot 'npm.cmd')) 'Wrong npm path selected.'
        if ($Mode -in @('system', 'cached')) {
            Assert-True ($calls.Count -eq 0) 'Existing runtime unexpectedly accessed the network.'
        } else {
            Assert-True ($calls.Count -eq 3) 'Bootstrap must download manifest/archive and extract exactly once.'
            Assert-True ($calls[0] -eq 'https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt') 'Wrong manifest source.'
            Assert-True ($calls[1] -eq 'https://nodejs.org/dist/v24.99.0/node-v24.99.0-win-x64.zip') 'Archive URL must use the manifest version.'
            Assert-True (Test-TarotNodeRuntime $runtime.NodePath $runtime.NpmPath) 'Installed portable runtime is incomplete.'
        }
    }
    $runtimeRoot = Join-Path $root '.runtime'
    if (Test-Path -LiteralPath $runtimeRoot) {
        Assert-True (@(Get-ChildItem -LiteralPath $runtimeRoot -Directory -Filter 'setup-*').Count -eq 0) 'Bootstrap staging directory was not cleaned.'
    }
}

$dependencyFiles = @(
    'node_modules\react\package.json',
    'node_modules\tsx\package.json',
    'node_modules\typescript\package.json',
    'node_modules\vite\package.json',
    'node_modules\tsx\dist\cli.mjs',
    'node_modules\typescript\bin\tsc',
    'node_modules\vite\bin\vite.js'
)

function Invoke-DependencyFixture {
    param([string]$Mode)
    . $setupScript
    $root = New-Fixture ('dependencies ' + $Mode)
    Write-FixtureFile (Join-Path $root 'package.json') '{"dependencies":{"react":"*"},"devDependencies":{"tsx":"*","typescript":"*","vite":"*"}}'
    $npmPath = Join-Path $root 'npm.cmd'
    $commands = @('@echo off', '> "%~dp0npm-call.txt" echo %*', '>> "%~dp0npm-call.txt" cd')
    if ($Mode -eq 'install') {
        foreach ($relative in $dependencyFiles) {
            $commands += 'if not exist "' + (Split-Path -Parent $relative) + '" mkdir "' + (Split-Path -Parent $relative) + '"'
            $commands += 'type nul > "' + $relative + '"'
        }
    }
    $exitCode = if ($Mode -eq 'failure') { 7 } else { 0 }
    $commands += 'exit /b ' + $exitCode
    Write-FixtureFile $npmPath ($commands -join "`r`n")
    if ($Mode -eq 'complete') {
        foreach ($relative in $dependencyFiles) { Write-FixtureFile (Join-Path $root $relative) '{}' }
    }
    $originalLocation = (Get-Location).Path
    if ($Mode -eq 'failure') {
        Assert-Throws { Install-TarotDependencies -ProjectRoot $root -NpmPath $npmPath } '7'
    } elseif ($Mode -eq 'incomplete') {
        Assert-Throws { Install-TarotDependencies -ProjectRoot $root -NpmPath $npmPath } 'npm install'
    } else {
        Install-TarotDependencies -ProjectRoot $root -NpmPath $npmPath
        Assert-True (Test-TarotDependencies $root) 'Dependency installation did not produce a complete project.'
    }
    Assert-True ((Get-Location).Path -eq $originalLocation) 'npm install changed the caller working directory.'
    $callPath = Join-Path $root 'npm-call.txt'
    if ($Mode -eq 'complete') {
        Assert-True (-not (Test-Path -LiteralPath $callPath)) 'Complete dependencies must skip npm install.'
    } else {
        $record = Get-Content -LiteralPath $callPath
        Assert-True ($record[0].Trim() -eq 'install --include=dev') 'npm install must include build-time dependencies.'
        Assert-True ($record[1].Trim() -eq $root) 'npm install must run from the project directory.'
    }
}

try {
    $env:PROCESSOR_ARCHITECTURE = 'AMD64'
    $env:PROCESSOR_ARCHITEW6432 = $null
    Invoke-SetupCase 'runtime version and npm presence' {
        . $setupScript
        $root = New-Fixture 'runtime-version'
        $nodePath = Join-Path $root 'node.cmd'
        $npmPath = Join-Path $root 'npm.cmd'
        $originalPath = $env:Path
        Write-FixtureFile $npmPath "@echo 11.0.0`r`n@exit /b 0"
        Write-FixtureFile $nodePath "@echo v24.1.0`r`n@exit /b 0"
        Assert-True (Test-TarotNodeRuntime $nodePath $npmPath) 'Node 24 must be accepted.'
        Assert-True ($env:Path -eq $originalPath) 'Runtime validation must restore PATH.'
        Write-FixtureFile $nodePath "@echo v22.1.0`r`n@exit /b 0"
        Assert-True (-not (Test-TarotNodeRuntime $nodePath $npmPath)) 'Old Node must be rejected.'
        Write-FixtureFile $nodePath "@echo v24.1.0`r`n@exit /b 9"
        Assert-True (-not (Test-TarotNodeRuntime $nodePath $npmPath)) 'A failing Node executable must be rejected.'
        Assert-True (-not (Test-TarotNodeRuntime $nodePath (Join-Path $root 'missing-npm.cmd'))) 'Missing npm must be rejected.'
        Write-FixtureFile $nodePath "@echo v24.1.0`r`n@exit /b 0"
        Write-FixtureFile $npmPath "@echo invalid`r`n@exit /b 0"
        Assert-True (-not (Test-TarotNodeRuntime $nodePath $npmPath)) 'Broken npm must be rejected.'
        Write-FixtureFile $npmPath "@echo 11.0.0`r`n@exit /b 8"
        Assert-True (-not (Test-TarotNodeRuntime $nodePath $npmPath)) 'A failing npm executable must be rejected.'
        Assert-True ($env:Path -eq $originalPath) 'Failed runtime validation must restore PATH.'
    }
    Invoke-SetupCase 'existing system runtime skips downloads' { Invoke-BootstrapFixture 'system' }
    Invoke-SetupCase 'cached portable runtime skips downloads' { Invoke-BootstrapFixture 'cached' }
    Invoke-SetupCase 'missing npm bootstraps portable runtime' { Invoke-BootstrapFixture 'missing-npm' }
    Invoke-SetupCase 'old Node bootstraps portable runtime' { Invoke-BootstrapFixture 'old-node' }
    Invoke-SetupCase 'checksum failure rejects archive and cleans staging' { Invoke-BootstrapFixture 'missing-npm' 'checksum' }
    Invoke-SetupCase 'download failure cleans staging' { Invoke-BootstrapFixture 'missing-npm' 'download' }
    Invoke-SetupCase 'missing dependencies install with dev tools at project cwd' { Invoke-DependencyFixture 'install' }
    Invoke-SetupCase 'complete dependencies skip npm install' { Invoke-DependencyFixture 'complete' }
    Invoke-SetupCase 'npm nonzero exit stops setup and restores cwd' { Invoke-DependencyFixture 'failure' }
    Invoke-SetupCase 'npm success with missing files stops setup' { Invoke-DependencyFixture 'incomplete' }
    Write-Host ('All ' + $script:passed + ' Windows setup checks passed.')
} finally {
    $env:PROCESSOR_ARCHITECTURE = $savedArchitecture
    $env:PROCESSOR_ARCHITEW6432 = $savedArchitecture6432
    $resolvedFixture = (Resolve-Path -LiteralPath $fixtureRoot -ErrorAction SilentlyContinue).Path
    $allowedRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot 'tmp')) + [IO.Path]::DirectorySeparatorChar
    if ($resolvedFixture -and $resolvedFixture.StartsWith($allowedRoot, [StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $resolvedFixture -Recurse -Force
    } else {
        throw 'Refusing to remove a fixture outside the project tmp directory.'
    }
}
