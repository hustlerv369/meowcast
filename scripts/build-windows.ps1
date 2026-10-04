$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$companionRoot = Join-Path $repoRoot 'meowmate'
$appRoot = Join-Path $repoRoot 'app'
$env:MEOWMATE_DEMO = '1'
Push-Location $companionRoot
try {
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw 'Companion dependency installation failed.' }
    & npm.cmd exec tauri -- build --no-bundle -- --locked
    if ($LASTEXITCODE -ne 0) { throw 'Companion build failed.' }
} finally { Pop-Location }
$staging = Join-Path $appRoot 'companion/meowmate'
[void][IO.Directory]::CreateDirectory($staging)
foreach ($name in @('coucou.exe','coucou-hook.exe')) {
    Copy-Item -LiteralPath (Join-Path $companionRoot "target/release/$name") -Destination (Join-Path $staging $name) -Force
}
foreach ($name in @('LICENSE','LICENSE-ASSETS.md','NOTICE.txt')) {
    Copy-Item -LiteralPath (Join-Path $repoRoot "meowmate/$name") -Destination (Join-Path $staging $name) -Force
}
Push-Location $appRoot
try {
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw 'Launcher dependency installation failed.' }
    & npm.cmd run check
    if ($LASTEXITCODE -ne 0) { throw 'Launcher checks failed.' }
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Launcher build failed.' }
    & npm.cmd run package -- --win nsis zip --publish never
    if ($LASTEXITCODE -ne 0) { throw 'Windows packaging failed.' }
} finally { Pop-Location }
