param([Parameter(Mandatory=$true)][string]$Source)
$ErrorActionPreference = 'Stop'
$destination = Join-Path (Split-Path -Parent $PSScriptRoot) 'companion/meowmate'
$files = @('coucou.exe', 'coucou-hook.exe', 'LICENSE', 'LICENSE-ASSETS.md', 'NOTICE.txt')
foreach ($name in $files) {
    $item = Get-Item -LiteralPath (Join-Path $Source $name)
    if ($item.PSIsContainer -or (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) {
        throw 'Companion payload must contain regular files only.'
    }
}
New-Item -ItemType Directory -Path $destination -Force | Out-Null
foreach ($existing in Get-ChildItem -LiteralPath $destination -Force) {
    if ($files -notcontains $existing.Name) { throw 'Unexpected file in companion staging. Inspect before packaging.' }
}
foreach ($name in $files) {
    Copy-Item -LiteralPath (Join-Path $Source $name) -Destination (Join-Path $destination $name) -Force
    if ((Get-FileHash -LiteralPath (Join-Path $Source $name)).Hash -ne (Get-FileHash -LiteralPath (Join-Path $destination $name)).Hash) {
        throw 'Companion staging hash mismatch.'
    }
}
Get-ChildItem -LiteralPath $destination | Select-Object Name,Length
