# Start the FaceAge science fair booth container on Windows (PowerShell).
# Expects the model at .\models\faceage_model.h5 and the image faceage:serve
# (run .\beurs-setup.ps1 once, see README.md). Ctrl+C stops the booth.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$modelsDir = (Resolve-Path models).Path
docker run --rm --name faceage-beurs -p 8000:8000 -v "${modelsDir}:/models:ro" faceage:serve
