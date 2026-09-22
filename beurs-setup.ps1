# Yearly setup for the FaceAge science fair booth on Windows (PowerShell 5.1 or newer).
# Needs internet once; afterwards the booth runs offline.
#
#   .\beurs-setup.ps1            pull the prebuilt image from GHCR (default)
#   .\beurs-setup.ps1 -Build     build the image locally instead
#
# If scripts are blocked:  powershell -ExecutionPolicy Bypass -File .\beurs-setup.ps1
#
# Steps: 1 Docker running  2 image  3 model file  4 smoke test
param([switch]$Build)

# native commands are checked via $LASTEXITCODE; keep PowerShell from turning
# their stderr output into terminating errors
$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"   # much faster Invoke-WebRequest downloads
Set-Location $PSScriptRoot

$Image       = "faceage:serve"
$ImageRemote = "ghcr.io/maastrichtu-cds/faceage-weekend-van-de-wetenschap:serve"
$Platform    = "linux/amd64"
$Model       = "models\faceage_model.h5"
$ModelUrl    = "https://github.com/AIM-Harvard/FaceAge/releases/download/v1/faceage_model.h5"
$ModelMin    = 80000000
$TestName    = "faceage-setup-test"
$TestPort    = 18000

function Ok($m)   { Write-Host "  [ok] $m" }
function Info($m) { Write-Host "  ...  $m" }
function Cleanup  { docker rm -f $TestName *> $null }
function Fail($m) { Cleanup; Write-Host ""; Write-Host "SETUP FAILED: $m" -ForegroundColor Red; exit 1 }

# ------------------------------------------------------------ 1 Docker
# `docker info` can hang (not fail) when Docker Desktop is up but its engine VM
# is unreachable, so every check is capped at 10 s.
function DockerUp {
  $job = Start-Job { docker info *> $null; $LASTEXITCODE }
  $done = Wait-Job $job -Timeout 10
  $code = if ($done) { Receive-Job $job } else { 1 }
  Remove-Job $job -Force
  return ($code -eq 0)
}
function WaitDocker($seconds) {
  $end = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $end) { if (DockerUp) { return $true }; Start-Sleep 2 }
  return $false
}
Write-Host "== 1/4 Docker"
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Fail "docker command not found. Install Docker Desktop: https://www.docker.com/products/docker-desktop/"
}
if (-not (DockerUp)) {
  $exe = Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"
  if ((Test-Path $exe) -and -not (Get-Process "Docker Desktop" -ErrorAction SilentlyContinue)) {
    Info "Docker Desktop is not running, starting it"; Start-Process $exe
  } else {
    Info "Docker engine not reachable, waiting for it"
  }
  if (-not (WaitDocker 90)) {
    Info "still unreachable; restarting Docker Desktop (docker desktop restart)"
    docker desktop restart *> $null
    if (-not (WaitDocker 120)) { Fail "Docker did not become reachable. Quit Docker Desktop completely (whale menu -> Quit), open it again, wait for the whale icon to settle, then rerun." }
  }
}
Ok "Docker $(docker version --format '{{.Server.Version}}') is running"

# ------------------------------------------------------------- 2 image
Write-Host "== 2/4 Docker image"
if ($Build) {
  Info "building $Image for $Platform (takes a while)"
  docker build --platform $Platform -f Dockerfile.serve -t $Image .
  if ($LASTEXITCODE -ne 0) { Fail "image build failed; check the internet connection and the output above" }
} else {
  Info "pulling $ImageRemote"
  docker pull --platform $Platform $ImageRemote | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail "image pull failed. Check the internet connection, or build locally with: .\beurs-setup.ps1 -Build" }
  docker tag $ImageRemote $Image
}
Ok "image $Image ($(docker image inspect $Image --format '{{.Os}}/{{.Architecture}}'))"

# ------------------------------------------------------------- 3 model
Write-Host "== 3/4 Model file"
function ModelOk {
  if (-not (Test-Path $Model)) { return $false }
  if ((Get-Item $Model).Length -lt $ModelMin) { return $false }
  $fs = [System.IO.File]::OpenRead((Resolve-Path $Model).Path)
  try { $b = New-Object byte[] 4; [void]$fs.Read($b, 0, 4) } finally { $fs.Close() }
  return ($b[1] -eq 0x48 -and $b[2] -eq 0x44 -and $b[3] -eq 0x46)   # HDF5 magic: \x89 H D F
}
if (ModelOk) {
  Ok "$Model present"
} else {
  Info "downloading $Model (~92 MB)"
  New-Item -ItemType Directory -Force -Path models | Out-Null
  try { Invoke-WebRequest -Uri $ModelUrl -OutFile "$Model.part" -UseBasicParsing -ErrorAction Stop }
  catch { Fail "model download failed; check the internet connection ($($_.Exception.Message))" }
  Move-Item -Force "$Model.part" $Model
  if (-not (ModelOk)) { Fail "downloaded file does not look like the FaceAge model (HDF5, ~92 MB)" }
  Ok "$Model downloaded"
}

# -------------------------------------------------------- 4 smoke test
Write-Host "== 4/4 Smoke test"
Cleanup
$modelsDir = (Resolve-Path models).Path
docker run -d --name $TestName --platform $Platform -p "127.0.0.1:${TestPort}:8000" -v "${modelsDir}:/models:ro" $Image | Out-Null
if ($LASTEXITCODE -ne 0) { Fail "could not start the test container" }
Info "starting the booth once (model load takes ~10-30 s)"
$up = $false
for ($i = 0; $i -lt 90 -and -not $up; $i++) {
  try { Invoke-WebRequest -Uri "http://127.0.0.1:$TestPort/" -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop | Out-Null; $up = $true }
  catch {
    $running = docker inspect -f '{{.State.Running}}' $TestName
    if ("$running".Trim() -ne "true") { docker logs --tail 20 $TestName; Fail "the booth container exited during start-up (see log above)" }
    Start-Sleep 2
  }
}
if (-not $up) { docker logs --tail 20 $TestName; Fail "the booth did not answer on port $TestPort within 3 minutes (see log above)" }

# post a blank photo from inside the container (no host dependencies): expect "no_face".
# The Python snippet is fed via stdin, which avoids PowerShell quoting of a multi-line argument.
$py = @'
import io, urllib.request, urllib.error
from PIL import Image
buf = io.BytesIO(); Image.new('RGB', (640, 480)).save(buf, format='JPEG')
b = (b'--x\r\nContent-Disposition: form-data; name="image"; filename="t.jpg"\r\n'
     b'Content-Type: image/jpeg\r\n\r\n' + buf.getvalue() + b'\r\n--x--\r\n')
req = urllib.request.Request('http://127.0.0.1:8000/predict', data=b,
                             headers={'Content-Type': 'multipart/form-data; boundary=x'})
try:
    print(urllib.request.urlopen(req, timeout=120).read().decode())
except urllib.error.HTTPError as e:
    print(e.read().decode())
'@
$result = ($py | docker exec -i $TestName python -) -join ""
Cleanup
if ("$result" -notlike "*no_face*") { Fail "unexpected /predict answer: $result" }
Ok "prediction pipeline works ($result)"

Write-Host ""
Write-Host "Setup complete. At the fair, start the booth with .\beurs-run.ps1 (or: docker compose up)"
Write-Host "and open http://localhost:8000"
