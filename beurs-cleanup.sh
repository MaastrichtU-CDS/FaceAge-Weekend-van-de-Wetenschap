#!/usr/bin/env bash
# Remove the FaceAge booth containers and Docker images, e.g. before a fresh
# ./beurs-setup.sh. Leaves the model file in models/ untouched, so a new
# setup only needs to fetch the image again.
#
#   ./beurs-cleanup.sh
set -euo pipefail
cd "$(dirname "$0")"

IMAGE=faceage:serve
IMAGE_REMOTE=ghcr.io/maastrichtu-cds/faceage-weekend-van-de-wetenschap:serve
CONTAINERS=(faceage-beurs faceage-setup-test)

ok()   { printf '  [ok] %s\n' "$*"; }
info() { printf '  ...  %s\n' "$*"; }
fail() { printf '\nCLEANUP FAILED: %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 \
  || fail "docker command not found. Install Docker Desktop: https://www.docker.com/products/docker-desktop/"

for name in "${CONTAINERS[@]}"; do
  if docker rm -f "$name" >/dev/null 2>&1; then
    ok "removed container $name"
  else
    info "container $name not present"
  fi
done

for image in "$IMAGE" "$IMAGE_REMOTE"; do
  if docker rmi "$image" >/dev/null 2>&1; then
    ok "removed image $image"
  else
    info "image $image not present"
  fi
done

# untagged leftovers from previous builds
RECLAIMED=$(docker image prune -f | tail -n 1)
ok "removed dangling images ($RECLAIMED)"

echo
echo "Cleanup complete. To reinstall, run ./beurs-setup.sh"
