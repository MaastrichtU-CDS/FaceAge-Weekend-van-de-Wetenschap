#!/usr/bin/env bash
# Yearly setup for the FaceAge science fair booth (macOS / Linux; on Windows
# use beurs-setup.ps1). Needs internet once; afterwards the booth runs offline.
#
#   ./beurs-setup.sh            pull the prebuilt image from GHCR (default)
#   ./beurs-setup.sh --build    build the image locally instead
#
# Steps: 1 Docker running  2 image  3 model file  4 smoke test
set -euo pipefail
cd "$(dirname "$0")"

IMAGE=faceage:serve
IMAGE_REMOTE=ghcr.io/maastrichtu-cds/faceage-weekend-van-de-wetenschap:serve
MODEL=models/faceage_model.h5
MODEL_URL=https://github.com/AIM-Harvard/FaceAge/releases/download/v1/faceage_model.h5
MODEL_MIN_BYTES=80000000
TEST_NAME=faceage-setup-test
TEST_PORT=18000

ok()   { printf '  [ok] %s\n' "$*"; }
info() { printf '  ...  %s\n' "$*"; }
fail() { printf '\nSETUP FAILED: %s\n' "$*" >&2; exit 1; }
cleanup() { docker rm -f "$TEST_NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

OS=$(uname -s)

# ---------------------------------------------------------------- 1 Docker
# `docker info` can hang (not fail) when Docker Desktop is up but its engine VM
# is unreachable, so every check is capped at 10 s (macOS has no `timeout`).
docker_up() {
  docker info >/dev/null 2>&1 & local p=$!
  for _ in $(seq 1 20); do kill -0 "$p" 2>/dev/null || { wait "$p"; return; }; sleep 0.5; done
  kill "$p" 2>/dev/null; wait "$p" 2>/dev/null; return 1
}
wait_docker() {  # $1 = max seconds
  local end=$(( $(date +%s) + $1 ))
  while (( $(date +%s) < end )); do docker_up && return 0; sleep 2; done
  return 1
}
echo "== 1/4 Docker"
command -v docker >/dev/null 2>&1 \
  || fail "docker command not found. Install Docker Desktop: https://www.docker.com/products/docker-desktop/"
if ! docker_up; then
  if [[ $OS == Darwin ]] && ! pgrep -q -f 'Docker.app/Contents/MacOS/com.docker.backend'; then
    info "Docker Desktop is not running, starting it"
    open -a Docker || fail "could not start Docker Desktop; open it from Applications and rerun"
  else
    info "Docker engine not reachable, waiting for it"
  fi
  if ! wait_docker 90; then
    if docker desktop --help >/dev/null 2>&1; then
      info "still unreachable; restarting Docker Desktop (docker desktop restart)"
      docker desktop restart >/dev/null 2>&1 || true
      wait_docker 120 || fail "Docker did not become reachable. Quit Docker Desktop completely (whale menu -> Quit), open it again, wait for the whale icon to settle, then rerun."
    else
      fail "Docker did not become reachable within 90 s. Restart Docker Desktop (whale menu -> Restart, or: docker desktop restart) and rerun."
    fi
  fi
fi
ok "Docker $(docker version --format '{{.Server.Version}}') is running"

# ---------------------------------------------------------------- 2 image
echo "== 2/4 Docker image"
if [[ ${1:-} == --build ]]; then
  info "building $IMAGE for the Docker host (takes a while)"
  docker build -f Dockerfile.serve -t "$IMAGE" . \
    || fail "image build failed; check the internet connection and the output above"
else
  info "pulling $IMAGE_REMOTE"
  docker pull "$IMAGE_REMOTE" >/dev/null \
    || fail "image pull failed. Check the internet connection, or build locally with: ./beurs-setup.sh --build"
  docker tag "$IMAGE_REMOTE" "$IMAGE"
fi
ok "image $IMAGE ($(docker image inspect "$IMAGE" --format '{{.Os}}/{{.Architecture}}'))"

# ---------------------------------------------------------------- 3 model
echo "== 3/4 Model file"
model_ok() {
  [[ -f $MODEL ]] || return 1
  [[ $(wc -c <"$MODEL") -ge $MODEL_MIN_BYTES ]] || return 1
  head -c 4 "$MODEL" | LC_ALL=C grep -a -q 'HDF' || return 1   # HDF5 magic bytes
}
if model_ok; then
  ok "$MODEL present"
else
  info "downloading $MODEL (~92 MB)"
  mkdir -p models
  curl -L --fail --progress-bar -o "$MODEL.part" "$MODEL_URL" \
    || fail "model download failed; check the internet connection"
  mv "$MODEL.part" "$MODEL"
  model_ok || fail "downloaded file does not look like the FaceAge model (HDF5, ~92 MB)"
  ok "$MODEL downloaded"
fi

# ----------------------------------------------------------- 4 smoke test
echo "== 4/4 Smoke test"
cleanup
docker run -d --name "$TEST_NAME" \
  -p "127.0.0.1:$TEST_PORT:8000" -v "$PWD/models:/models:ro" "$IMAGE" >/dev/null
info "starting the booth once (model load takes ~10-30 s)"
for _ in $(seq 1 90); do
  if curl -s -o /dev/null -m 3 "http://127.0.0.1:$TEST_PORT/"; then break; fi
  if [[ $(docker inspect -f '{{.State.Running}}' "$TEST_NAME") != true ]]; then
    docker logs "$TEST_NAME" 2>&1 | tail -20
    fail "the booth container exited during start-up (see log above)"
  fi
  sleep 2
done
curl -s -o /dev/null -m 3 "http://127.0.0.1:$TEST_PORT/" \
  || { docker logs "$TEST_NAME" 2>&1 | tail -20; fail "the booth did not answer on port $TEST_PORT within 3 minutes (see log above)"; }
# post a blank photo from inside the container (no host dependencies): expect "no_face"
RESULT=$(docker exec "$TEST_NAME" python -c '
import io, json, urllib.request
from PIL import Image
buf = io.BytesIO(); Image.new("RGB", (640, 480)).save(buf, format="JPEG")
b = b"--x\r\nContent-Disposition: form-data; name=\"image\"; filename=\"t.jpg\"\r\nContent-Type: image/jpeg\r\n\r\n" + buf.getvalue() + b"\r\n--x--\r\n"
req = urllib.request.Request("http://127.0.0.1:8000/predict", data=b, headers={"Content-Type": "multipart/form-data; boundary=x"})
try:
    print(urllib.request.urlopen(req, timeout=120).read().decode())
except urllib.error.HTTPError as e:
    print(e.read().decode())
')
[[ $RESULT == *no_face* ]] || fail "unexpected /predict answer: $RESULT"
ok "prediction pipeline works ($RESULT)"

echo
echo "Setup complete. At the fair, start the booth with ./beurs-run.sh (or: docker compose up)"
echo "and open http://localhost:8000"
