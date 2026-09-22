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
2. on an Apple Silicon Mac, installs Rosetta if missing;
3. pulls the prebuilt image from GHCR (or builds it locally with `--build` / `-Build`);
4. on an Apple Silicon Mac, verifies that Docker runs amd64 images through Rosetta rather than QEMU (TensorFlow needs this) and tells you exactly which Docker Desktop setting to change if not;
5. downloads the ~92 MB model into `models/` if it is missing or damaged;
6. starts the booth once on a test port and sends it a blank photo to confirm the whole pipeline works.

It is safe to rerun at any time: steps that are already done are skipped. It ends with `Setup complete`, or with `SETUP FAILED: ...` and the reason.

<details>
<summary>Manual setup (what the script does, step by step)</summary>

**1. Get the Docker image** — either build it locally:

```bash
docker build --platform linux/amd64 -f Dockerfile.serve -t faceage:serve .
```

…or pull the prebuilt package from GHCR (built via **Actions → "Build Docker image" → "Run workflow"**):

```bash
docker pull --platform linux/amd64 ghcr.io/maastrichtu-cds/faceage-weekend-van-de-wetenschap:serve
docker tag ghcr.io/maastrichtu-cds/faceage-weekend-van-de-wetenschap:serve faceage:serve
```

**2. Fetch the model file** (once, ~92 MB, from the original authors' release):

```bash
mkdir -p models && curl -L -o models/faceage_model.h5 https://github.com/AIM-Harvard/FaceAge/releases/download/v1/faceage_model.h5
```

The `models/` folder is mounted into the container as read-only at runtime; the model file itself is git-ignored.

</details>

### Platform notes

The image is `linux/amd64` only, because TensorFlow 2.6 has no ARM Linux build. All scripts and commands pin `--platform linux/amd64`; on Windows and Linux x86_64 this is a no-op.

**Windows** — Docker Desktop (WSL 2 backend). Use the PowerShell scripts (`beurs-setup.ps1`, `beurs-run.ps1`; written for Windows PowerShell 5.1 and newer, not yet exercised on a Windows machine) or `docker compose up`, which is unchanged from previous years. The bash scripts also work from Git Bash.

**macOS** — tested on macOS 26 with Docker Desktop 4.84 on an Apple Silicon (M-series) Mac.

- Docker Desktop must be running before `./beurs-run.sh` or `docker compose up`. The setup script starts it for you; otherwise open it from Applications and wait for the whale icon in the menu bar to settle.
- On Apple Silicon, Docker Desktop runs the image through **Rosetta**. This is the default (*Settings → General → "Use Rosetta for x86_64/amd64 emulation on Apple Silicon"*) but it requires Rosetta to be installed; without it Docker silently falls back to QEMU, which lacks the AVX instructions TensorFlow needs. The setup script detects this. Model loading takes ~10 s and a prediction ~2 s under Rosetta.
- To restart the Docker daemon on a Mac, restart Docker Desktop: `docker desktop restart` in a terminal, or whale menu → *Restart*. Then wait until `docker info` succeeds. The setup script does this automatically when the engine does not respond.

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
| `docker compose up` stalls at `Attaching to faceage-beurs` with no log lines (Apple Silicon Mac) | Docker is emulating with QEMU instead of Rosetta, so TensorFlow never finishes importing. Run `./beurs-setup.sh`, which detects this, or check manually: `docker exec faceage-beurs grep -c avx2 /proc/cpuinfo` prints `0`. Fix: install Rosetta (`softwareupdate --install-rosetta --agree-to-license`), enable *Settings → General → Use Rosetta for x86_64/amd64 emulation* in Docker Desktop, Apply & restart, then `docker compose down` and start again. |
| Setup script says `SETUP FAILED` | The line after it names the failing step and the fix. Rerun the script after fixing; completed steps are skipped. |

## Notes

**CPU or GPU?** CPU only. The image installs the standard (CPU) build of TensorFlow 2.6 and is designed to run on an ordinary booth laptop with no GPU or special drivers. A few seconds per prediction is normal.

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
