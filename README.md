# FaceAge — Weekend van de Wetenschap (science fair booth)

This repo packages the [FaceAge](https://github.com/AIM-Harvard/FaceAge) deep-learning model by AIM-Harvard — published in *The Lancet Digital Health* (2025), "FaceAge, a deep learning system to estimate biological age from face photographs to improve prognostication" — as a standalone, self-contained booth for the Weekend van de Wetenschap science fair. A bilingual (NL/EN) web page takes a webcam photo and shows a rounded FaceAge estimate. Photos are processed in memory only and are never saved; the result view automatically resets after 30 seconds; and once the Docker image and model file are on the booth laptop, no internet connection is needed at the fair.

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

## Privacy

- Photos are processed **in memory only** — there is no uploads folder, no temp files, no database, and no photo data in the logs.
- All traffic stays on `localhost`; nothing leaves the booth laptop.
- The result view automatically resets after 30 seconds, ready for the next visitor.

## Disclaimer

This is a research demo for science communication, **not medical advice**, and is provided **"as is"** without any warranty. See the original [FaceAge repository](https://github.com/AIM-Harvard/FaceAge) for the model, paper and its intended use.
