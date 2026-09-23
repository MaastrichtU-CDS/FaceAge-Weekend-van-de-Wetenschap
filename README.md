# FaceAge — Weekend van de Wetenschap (Science Fair Booth)

This repository packages the [FaceAge](https://github.com/AIM-Harvard/FaceAge) deep learning model by AIM-Harvard — published in *The Lancet Digital Health* (2025), "FaceAge, a deep learning system to estimate biological age from face photographs to improve prognostication" — as a standalone, self-contained booth for the *Weekend van de Wetenschap* (Dutch Science Weekend) science fair. A bilingual (NL/EN) web page with a child-friendly colourful interface takes a webcam photo and displays a rounded FaceAge estimate. Photos are processed in memory only and are never saved; the result view automatically resets after 30 seconds; and once the Docker image and model file are on the booth laptop, no internet connection is needed at the fair.

## Yearly Setup (requires internet)

Perform this once per year on the booth laptop, with internet access. The setup script checks everything and downloads what is missing:

```bash
./beurs-setup.sh            # macOS / Linux
```

```powershell
.\beurs-setup.ps1           # Windows (PowerShell; if blocked: powershell -ExecutionPolicy Bypass -File .\beurs-setup.ps1)
```

The script:

1. checks that Docker is installed and running (and starts Docker Desktop if it is not);
2. pulls the prebuilt image for the Docker host's architecture from GHCR (or builds it locally with `--build` / `-Build`);
3. downloads the ~92 MB model into `models/` if it is missing or damaged;
4. starts the booth once on a test port and sends it a blank photo to confirm the whole pipeline works.

It is safe to rerun at any time: steps that are already done are skipped. It ends with `Setup complete`, or with `SETUP FAILED: ...` and the reason.

When upgrading an existing Intel-only installation on Apple Silicon, run `./beurs-setup.sh --build` once to replace the old local image. This also works before the updated ARM64 image has been published to GHCR.

<details>
<summary>Manual setup (what the script does, step by step)</summary>

**1. Get the Docker image** — either build it locally:

```bash
docker build -f Dockerfile.serve -t faceage:serve .
```

…or pull the prebuilt package from GHCR (built via **Actions → "Build Docker image" → "Run workflow"**):

```bash
docker pull ghcr.io/maastrichtu-cds/faceage-weekend-van-de-wetenschap:serve
docker tag ghcr.io/maastrichtu-cds/faceage-weekend-van-de-wetenschap:serve faceage:serve
docker rmi ghcr.io/maastrichtu-cds/faceage-weekend-van-de-wetenschap:serve   # drop the remote tag so a single image remains
```

**2. Fetch the model file** (once, ~92 MB, from the original authors' release):

```bash
mkdir -p models && curl -L -o models/faceage_model.h5 https://github.com/AIM-Harvard/FaceAge/releases/download/v1/faceage_model.h5
```

The `models/` folder is mounted into the container as read-only at runtime; the model file itself is git-ignored.

</details>

### Platform notes

The image uses Python 3.11 and TensorFlow 2.15.1 with Keras 2.15. Docker builds support `linux/amd64` and `linux/arm64`; the scripts use the Docker host's architecture. Apple Silicon runs ARM64 directly, without Rosetta. Keras 2 is retained for compatibility with the original model; its Python 3.6 Lambda layers are loaded using an equivalent scale-sum function.

**Windows** — Docker Desktop (WSL 2 backend). Use the PowerShell scripts (`beurs-setup.ps1`, `beurs-run.ps1`, `beurs-cleanup.ps1`; written for Windows PowerShell 5.1 and newer, not yet exercised on a Windows machine) or `docker compose up`, which is unchanged from previous years. The bash scripts also work from Git Bash.

**macOS** — use Docker Desktop or OrbStack on Apple Silicon (M-series) or Intel Macs.

The TensorFlow 2.15.1 pipeline has been checked on macOS 26.6.2 ARM64, both directly in Python and in an ARM64 OrbStack container, including a single-face prediction.

- Your Docker engine must be running before `./beurs-run.sh` or `docker compose up`. The setup script can start Docker Desktop; if using OrbStack, open it first.
- To restart the Docker daemon on a Mac, restart Docker Desktop or OrbStack and wait until `docker info` succeeds.

### Native macOS (without Docker)

With Python 3.11 installed, run these commands from the repository directory:

```bash
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install -r app/requirements.txt
python -m pip install --no-deps mtcnn==0.1.1
mkdir -p models
curl -L --fail -o models/faceage_model.h5 https://github.com/AIM-Harvard/FaceAge/releases/download/v1/faceage_model.h5
FACEAGE_MODEL_PATH="$PWD/models/faceage_model.h5" python app/server.py
```

Open <http://localhost:8000> and allow camera access. On Apple Silicon, use an ARM64 Python installation. This runs on CPU; `tensorflow-metal` is not required.

To check model loading, inference, and HTTP request handling without a webcam:

```bash
FACEAGE_MODEL_PATH="$PWD/models/faceage_model.h5" python app/smoke_test.py
# Optionally append a path to a single-face photo to also check the full pipeline.
```

## Running at the Fair (offline)

```bash
./beurs-run.sh              # macOS / Linux
```

```powershell
.\beurs-run.ps1             # Windows
```

…or on any platform:

```bash
docker compose up
```

Then open <http://localhost:8000> on the booth laptop and allow camera access for `localhost` when the browser prompts you.

## Cleanup

Removes the booth containers and the Docker images, including the untagged leftovers of previous builds, so nothing is left dangling. The model file in `models/` is kept, so a rerun of the setup only needs to fetch the image again:

```bash
./beurs-cleanup.sh            # macOS / Linux
```

```powershell
.\beurs-cleanup.ps1           # Windows (if blocked: powershell -ExecutionPolicy Bypass -File .\beurs-cleanup.ps1)
```

It is safe to rerun at any time, even while the booth is running (the booth stops; start it again with `./beurs-run.sh`).

## Troubleshooting

| Problem | Solution |
|---|---|
| Model not found at start-up | Ensure `models/faceage_model.h5` exists and the volume mount is present: `-v "$PWD/models:/models:ro"` (both `beurs-run.sh` and `docker-compose.yml` already do this). |
| Camera error in the browser | Grant camera permission for `localhost` in the browser's site settings, then reload the page. |
| Page not loading | Check `docker ps` to confirm the `faceage-beurs` container is running, and that port 8000 is free. |
| Port 8000 already in use | Map a different host port, e.g. `docker run --rm -p 8080:8000 -v "$PWD/models:/models:ro" faceage:serve`, and open <http://localhost:8080>. |
| Slow predictions | The image runs on CPU only; a few seconds per prediction is normal. |
| `Cannot connect to the Docker daemon` | Docker Desktop is not running. Open it and wait for the whale icon to settle; on a Mac `open -a Docker`. |
| Docker commands hang with no output (`docker info`, `docker compose up` stuck before `Attaching to`) | Docker Desktop shows as running but its engine is unreachable (happens after sleep or a quick quit/reopen). Run `docker desktop restart` (or whale menu → Restart) and wait ~30 s. `./beurs-setup.sh` / `.\beurs-setup.ps1` detect this and restart it for you. |
| Old Intel image still runs on Apple Silicon | Run `./beurs-setup.sh --build`, then `docker compose up --force-recreate` to use the new native ARM64 image. |
| Setup script says `SETUP FAILED` | The line after it names the failing step and the fix. Rerun the script after fixing; completed steps are skipped. |

## Notes

**CPU or GPU?** CPU only. The image uses TensorFlow 2.15.1 and is designed to run on an ordinary booth laptop with no GPU or special drivers.

**Pack the model into the image?** By default, the model is kept out of the image and mounted as read-only at runtime — this keeps the image (and the GHCR package) small. If you prefer a single self-contained image, bake the ~92 MB model in with a tiny variant Dockerfile:

```dockerfile
# Dockerfile.serve-with-model  (model baked in; ~92 MB larger image)
FROM faceage:serve
COPY models/faceage_model.h5 /models/faceage_model.h5
```

Build and run it **without** the volume mount (fetch the model first, see "Yearly Setup"):

```bash
docker build -f Dockerfile.serve -t faceage:serve .
docker build -f Dockerfile.serve-with-model -t faceage:serve-with-model .
docker run --rm -p 8000:8000 faceage:serve-with-model
```

> Note: `Dockerfile.serve-with-model` is optional and not required for the fair; the default setup (model mounted from `models/`) already works fully offline once the file is downloaded.

## Privacy & Security

- Photos are processed **in memory only** — there is no uploads folder, no temporary files, no database, and no photo data in the logs.
- **No external network calls**: The application code contains no HTTP libraries (requests, urllib, httpx, etc.) and makes no outgoing network requests. All communication is with the browser on `localhost` via the `/predict` endpoint.
- **No browser storage**: The frontend does not use localStorage, sessionStorage, or cookies to persist any data.
- **No tracking**: No analytics, beacons, or tracking scripts are included.
- **No file I/O**: Beyond reading the model file at start-up, no files are written or read — the `.save()` call in inference.py writes to an in-memory BytesIO buffer, not to disk.
- All traffic stays on `localhost`; nothing leaves the booth laptop.
- The result view automatically resets after 30 seconds, ready for the next visitor.
- The interface uses a cheerful, child-friendly colour scheme designed for younger audiences.

**Note for deployment**: While the application itself has no network calls, for maximum security at the fair booth, you can run the container with `--network none` (add to `docker-compose.yml` and `beurs-run.sh`) to block all network access at the Docker level.

## Disclaimer

This is a research demonstration for science communication, **not medical advice**, and is provided **"as is"** without any warranty. See the original [FaceAge repository](https://github.com/AIM-Harvard/FaceAge) for the model, paper and its intended use.
