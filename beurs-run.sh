#!/usr/bin/env bash
# Start the FaceAge science fair booth container.
# Expects the model at ./models/faceage_model.h5 and the image
# faceage:serve to be built (see README.md).
set -euo pipefail

docker run --rm \
  --name faceage-beurs \
  --network none \
  -p 8000:8000 \
  -v "$PWD/models:/models:ro" \
  faceage:serve
