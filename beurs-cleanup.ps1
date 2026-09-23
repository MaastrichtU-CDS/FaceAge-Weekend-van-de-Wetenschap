# Remove the FaceAge booth containers and Docker images on Windows (PowerShell
# 5.1 or newer), e.g. before a fresh .\beurs-setup.ps1. Leaves the model file
# in models\ untouched, so a new setup only needs to fetch the image again.
#
# If scripts are blocked:  powershell -ExecutionPolicy Bypass -File .\beurs-cleanup.ps1

# native commands are checked via $LASTEXITCODE; keep PowerShell from turning
# their stderr output into terminating errors
$ErrorActionPreference = "Continue"
Set-Location $PSScriptRoot

$Image       = "faceage:serve"
$ImageRemote = "ghcr.io/maastrichtu-cds/faceage-weekend-van-de-wetenschap:serve"
$Containers  = @("faceage-beurs", "faceage-setup-test")

function Ok($m)   { Write-Host "  [ok] $m" }
function Info($m) { Write-Host "  ...  $m" }

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Host "" ; Write-Host "CLEANUP FAILED: docker command not found. Install Docker Desktop: https://www.docker.com/products/docker-desktop/" -ForegroundColor Red
  exit 1
}

foreach ($name in $Containers) {
  docker rm -f $name *> $null
  if ($LASTEXITCODE -eq 0) { Ok "removed container $name" } else { Info "container $name not present" }
}

foreach ($image in @($Image, $ImageRemote)) {
  docker rmi $image *> $null
  if ($LASTEXITCODE -eq 0) { Ok "removed image $image" } else { Info "image $image not present" }
}

# untagged leftovers from previous builds
$prune = @(docker image prune -f)
Ok "removed dangling images ($($prune[-1]))"

Write-Host ""
Write-Host "Cleanup complete. To reinstall, run .\beurs-setup.ps1"
