# FaceAge — Weekend van de Wetenschap (science fair booth)

This repo packages the [FaceAge](https://github.com/AIM-Harvard/FaceAge) deep-learning model by AIM-Harvard — published in *The Lancet Digital Health* (2025), "FaceAge, a deep learning system to estimate biological age from face photographs to improve prognostication" — as a standalone, self-contained booth for the Weekend van de Wetenschap science fair. A bilingual (NL/EN) web page with a child-friendly colorful interface takes a webcam photo and shows a rounded FaceAge estimate. Photos are processed in memory only and are never saved; the result view automatically resets after 30 seconds. **The container runs with no network access (`--network none`) for maximum privacy and security — no data can be uploaded anywhere.**

## Yearly setup (needs internet)

Do this once per year, on a machine with internet access (e.g. when preparing the booth laptop).

**1. Get the Docker image** — either build it locally:

```bash
docker build -f Dockerfile.serve -t faceage:serve .
```

…or pull the prebuilt package from GHCR (built via **Actions → "Build Docker image" → "Run workflow"**):

```bash
docker pull ghcr.io/maastrichtu-cds/faceage-weekend-van-de-wetenschap:serve
docker tag ghcr.io/maastrichtu-cds/faceage-weekend-van-de-wetenschap:serve faceage:serve
```

**2. Fetch the model file** (once, ~1 GB, from the original authors' release):

```bash
mkdir -p models && curl -L -o models/faceage_model.h5 https://github.com/AIM-Harvard/FaceAge/releases/download/v1/faceage_model.h5
```

The `models/` folder is mounted into the container read-only at runtime; the model file itself is git-ignored.

## Running at the fair (offline)

```bash
./beurs-run.sh
# or:
docker compose up
```

Then open <http://localhost:8000> on the booth laptop and allow camera access for `localhost` when the browser asks.

## Troubleshooting

| Problem | Fix |
|---|---|
| Model not found at start-up | Make sure `models/faceage_model.h5` exists and the volume mount is present: `-v "$PWD/models:/models:ro"` (both `beurs-run.sh` and `docker-compose.yml` already do this). |
| Camera error in the browser | Grant camera permission for `localhost` in the browser's site settings, then reload the page. |
| Page not loading | Check `docker ps` to confirm the `faceage-beurs` container is running, and that port 8000 is free. |
| Port 8000 already in use | Map a different host port, e.g. `docker run --rm -p 8080:8000 -v "$PWD/models:/models:ro" faceage:serve`, and open <http://localhost:8080>. |
| Slow predictions | The image runs CPU-only; a few seconds per prediction is normal. |

## Notes

**CPU or GPU?** CPU-only. The image installs the standard (CPU) build of TensorFlow 2.6 and is meant to run on an ordinary booth laptop with no GPU or special drivers. A few seconds per prediction is normal.

**Pack the model into the image?** By default the model is kept out of the image and mounted read-only at runtime — this keeps the image (and the GHCR package) small. If you prefer a single self-contained image, bake the ~92 MB model in with a tiny variant Dockerfile:

```dockerfile
# Dockerfile.serve-with-model  (model baked in; ~92 MB larger image)
FROM faceage:serve
COPY models/faceage_model.h5 /models/faceage_model.h5
```

Build and run it **without** the volume mount (fetch the model first, see "Yearly setup"):

```bash
docker build -f Dockerfile.serve -t faceage:serve .
docker build -f Dockerfile.serve-with-model -t faceage:serve-with-model .
docker run --rm -p 8000:8000 faceage:serve-with-model
```

> Note: `Dockerfile.serve-with-model` is optional and not required for the fair; the default setup (model mounted from `models/`) already works fully offline once the file is downloaded.

## Privacy & Security

- Photos are processed **in memory only** — there is no uploads folder, no temp files, no database, and no photo data in the logs.
- **Network isolation**: The container runs with `--network none` (in `docker-compose.yml` and `beurs-run.sh`), meaning it has **zero network access** — no outgoing internet connections are possible, and no data can be uploaded anywhere.
- All traffic stays on `localhost`; nothing leaves the booth laptop.
- The result view automatically resets after 30 seconds, ready for the next visitor.
- The interface uses a cheerful, child-friendly color scheme designed for younger audiences.

## Disclaimer

This is a research demo for science communication, **not medical advice**, and is provided **"as is"** without any warranty. See the original [FaceAge repository](https://github.com/AIM-Harvard/FaceAge) for the model, paper and its intended use.
