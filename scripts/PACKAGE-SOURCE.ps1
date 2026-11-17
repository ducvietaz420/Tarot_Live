$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$zipPath = Join-Path $projectRoot 'TIEM-TAROT-SOURCE.zip'
if (Test-Path -LiteralPath $zipPath) { throw 'TIEM-TAROT-SOURCE.zip already exists. Rename the previous archive before packaging again.' }
$files = @()
foreach ($folder in @('src','server','shared','public','scripts','tests','docs')) {
    $files += Get-ChildItem -LiteralPath (Join-Path $projectRoot $folder) -File -Recurse
}
foreach ($name in @('package.json','package-lock.json','tsconfig.json','vite.config.ts','index.html','START.cmd','START.bat','README.md','ASSETS.md','.gitignore','.env.example','backend/.env.example')) {
    $files += Get-Item -LiteralPath (Join-Path $projectRoot $name)
}
$files += Get-ChildItem -LiteralPath (Join-Path $projectRoot 'qa') -File | Where-Object { $_.Extension -eq '.jpg' -or $_.Name -in @('test-results.txt','restart-result.json','gemini-check.json','ai-feature-check.json','ai-concise-check.json','ai-full-restored-check.json','followup-feature.json','demo-ai-av-check.json','audio-continuity-check.json','continuity-result.json') }
$archive = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($file in ($files | Sort-Object -Property FullName -Unique)) {
        if (-not $file.FullName.StartsWith($projectRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'File outside project.' }
        if ($file.Name -eq '.env' -or $file.Extension -match '^\.sqlite' -or $file.FullName -match '[\\/]node_modules[\\/]|[\\/]data[\\/]') { throw 'Private runtime file cannot be packaged.' }
        $relative = $file.FullName.Substring($projectRoot.Length + 1).Replace('\','/')
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.FullName, $relative, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
} finally { $archive.Dispose() }
Write-Output $zipPath
