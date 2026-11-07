$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$python = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $python) {
    $python = "C:/Users/Hari Saran/AppData/Local/Microsoft/WindowsApps/python3.12.exe"
}

Push-Location $projectRoot
try {
    & $python -m PyInstaller `
        --noconfirm `
        --clean `
        --onefile `
        --windowed `
        --name FlowlineTrafficStudio `
        --version-file version_info.txt `
        --hidden-import traffic_sim `
        traffic_app.pyw

    if ($LASTEXITCODE -ne 0) {
        throw "PyInstaller failed with exit code $LASTEXITCODE."
    }

    $exe = Join-Path $projectRoot "dist\FlowlineTrafficStudio.exe"
    if (-not (Test-Path -LiteralPath $exe)) {
        throw "Expected executable was not created: $exe"
    }

    $releaseFolder = Join-Path $projectRoot "dist\Flowline-Windows"
    New-Item -ItemType Directory -Force -Path $releaseFolder | Out-Null
    Copy-Item -LiteralPath $exe -Destination $releaseFolder -Force
    Copy-Item -LiteralPath (Join-Path $projectRoot "LICENSE") -Destination $releaseFolder -Force
    Copy-Item -LiteralPath (Join-Path $projectRoot "USER_GUIDE.md") -Destination $releaseFolder -Force

    $archive = Join-Path $projectRoot "dist\Flowline-Windows.zip"
    Compress-Archive -Path (Join-Path $releaseFolder "*") -DestinationPath $archive -Force

    Write-Host "Windows app: $exe"
    Write-Host "Portable package: $archive"
}
finally {
    Pop-Location
}
