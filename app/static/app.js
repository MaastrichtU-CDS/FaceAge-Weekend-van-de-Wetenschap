/*
 * FaceAge science fair booth interface.
 *
 * Handles the webcam stream, automatic and manual photo capture, language
 * switching and the automatic reset timer. While the camera view is shown,
 * small low-resolution frames are sent to /detect a few times per second;
 * once a single face has stayed still for a few seconds the photo is taken
 * automatically. Photos are turned into an in-memory blob, sent to
 * /predict and then discarded. Nothing is stored in localStorage,
 * sessionStorage or browser downloads.
 */

"use strict";

// all visible UI texts, kept at B1 level
const TEXTS = {
  nl: {
    welcome: "Welkom! Ga voor de camera staan.",
    instructions: "Kijk recht in de camera en blijf even stilstaan. De foto wordt dan vanzelf gemaakt.",
    instructions_manual: "Kijk recht in de camera en druk op de knop (of op Enter of de spatiebalk) om een foto te maken.",
    capture: "Neem nu een foto",
    face_searching: "We zoeken je gezicht…",
    face_found: "Gezicht gevonden! Blijf stilstaan…",
    loading: "Even geduld. We bekijken je foto.",
    result: "Jouw geschatte leeftijd is: {age} jaar.",
    result_explanation: "Dit is een schatting op basis van je gezicht.",
    retry: "Opnieuw",
    no_face: "We konden geen gezicht vinden. Kijk recht in de camera en probeer opnieuw.",
    multiple_faces: "We zien meer dan één gezicht. Zorg dat je alleen op de foto staat.",
    camera_error: "We kunnen de camera niet gebruiken. Controleer of je toestemming hebt gegeven.",
    general_error: "Er ging iets mis. Probeer het opnieuw.",
    reset_note: "Dit scherm gaat zo terug naar het begin.",
    privacy: "Je foto wordt niet opgeslagen. Na de meting wordt de foto verwijderd.",
    research_notice: "Dit is een onderzoekstoepassing. Het resultaat is geen medisch advies."
  },
  en: {
    welcome: "Welcome! Stand in front of the camera.",
    instructions: "Look straight at the camera and hold still for a moment. The photo is then taken automatically.",
    instructions_manual: "Look straight at the camera and press the button (or Enter or the space bar) to take a photo.",
    capture: "Take a photo now",
    face_searching: "We are looking for your face…",
    face_found: "Face found! Hold still…",
    loading: "Please wait. We are checking your photo.",
    result: "Your estimated age is: {age} years.",
    result_explanation: "This is an estimate based on your face.",
    retry: "Try again",
    no_face: "We could not find a face. Look straight at the camera and try again.",
    multiple_faces: "We can see more than one face. Make sure you are the only person in the photo.",
    camera_error: "We cannot use the camera. Check that you allowed camera access.",
    general_error: "Something went wrong. Please try again.",
    reset_note: "This screen will return to the start soon.",
    privacy: "Your photo is not saved. It is removed after the measurement.",
    research_notice: "This is a research application. The result is not medical advice."
  }
};

// automatic return to the start screen after a result or error
const RESET_DELAY_MS = 30000;

// automatic capture: set to false to only use the button / Enter / Space
const AUTO_CAPTURE = true;
// how long a single face must stay still before the photo is taken
const HOLD_STILL_MS = 2500;
// pause between the answer of one detection request and the next request
const DETECT_INTERVAL_MS = 300;
// width of the small frame sent to /detect (keeps detection fast on CPU)
const DETECT_FRAME_WIDTH = 320;
// how far the face may drift during the hold, as a fraction of its own size
const MAX_DRIFT = 0.25;
// how much the face may grow or shrink during the hold (ratio)
const MAX_SIZE_CHANGE = 1.3;
// fallback: after this many detection requests in a row have failed, or
// taken longer than DETECT_SLOW_MS, automatic capture is switched off and
// the page tells visitors to use the button or Enter instead
const MAX_DETECT_FAILURES = 5;
const DETECT_SLOW_MS = 2000;

// Dutch is the default language; the choice is kept (in memory only)
// so the next visitor sees the same language
let currentLang = "nl";

let stream = null;
let resetTimer = null;

// face watcher state; the generation counter makes stale /detect answers
// (from before a capture or reset) harmless
let watchGeneration = 0;
let watchTimer = null;
let anchorFace = null;
let stillSince = null;
let autoCapture = AUTO_CAPTURE;
let detectFailures = 0;

const views = {
  camera: document.getElementById("view-camera"),
  loading: document.getElementById("view-loading"),
  result: document.getElementById("view-result"),
  error: document.getElementById("view-error")
};

const video = document.getElementById("webcam");
const canvas = document.getElementById("snapshot");
const detectCanvas = document.getElementById("detect-frame");
const captureBtn = document.getElementById("capture-btn");
const instructions = document.getElementById("instructions");
const faceStatus = document.getElementById("face-status");
const holdBar = document.getElementById("hold-bar");
const holdProgress = document.getElementById("hold-progress");
const resultText = document.getElementById("result-text");
const errorText = document.getElementById("error-text");

function t(key) {
  return TEXTS[currentLang][key];
}

function applyLanguage(lang) {
  currentLang = lang;
  document.documentElement.lang = lang;
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.getElementById("lang-nl").classList.toggle("active", lang === "nl");
  document.getElementById("lang-en").classList.toggle("active", lang === "en");
}

function showView(name) {
  Object.entries(views).forEach(([viewName, el]) => {
    el.hidden = viewName !== name;
  });
}

async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" },
      audio: false
    });
    video.srcObject = stream;
    // wait until the first frame has arrived; a photo taken before that
    // would be empty
    await new Promise((resolve) => {
      if (video.videoWidth) {
        resolve();
      } else {
        video.addEventListener("loadedmetadata", resolve, { once: true });
      }
    });
    captureBtn.disabled = false;
    startFaceWatch();
  } catch (err) {
    showError("camera_error");
  }
}

function stopCamera() {
  stopFaceWatch();
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }
  video.srcObject = null;
}

function clearResetTimer() {
  if (resetTimer) {
    clearTimeout(resetTimer);
    resetTimer = null;
  }
}

function scheduleReset() {
  clearResetTimer();
  resetTimer = setTimeout(resetApp, RESET_DELAY_MS);
}

function wipeCanvas(target) {
  // wipe an in-memory frame; the canvas is also shrunk to zero so no
  // pixel data lingers
  const ctx = target.getContext("2d");
  ctx.clearRect(0, 0, target.width, target.height);
  target.width = 0;
  target.height = 0;
}

function clearSnapshot() {
  wipeCanvas(canvas);
  wipeCanvas(detectCanvas);
}

async function resetApp() {
  clearResetTimer();
  clearSnapshot();
  resultText.textContent = "";
  errorText.textContent = "";
  captureBtn.disabled = true;
  showView("camera");
  // restart the camera so the next visitor gets a fresh stream
  stopCamera();
  await startCamera();
}

function showError(code) {
  stopFaceWatch();
  errorText.textContent = t(code) || t("general_error");
  showView("error");
  scheduleReset();
}

/* ---------- automatic capture ---------- */

function setFaceStatus(key, progress) {
  faceStatus.dataset.i18n = key;
  faceStatus.textContent = t(key);
  faceStatus.classList.toggle("found", key === "face_found");
  holdBar.hidden = key !== "face_found";
  holdProgress.style.width = Math.round(Math.min(progress, 1) * 100) + "%";
}

function useManualCapture() {
  // button / Enter only: used when automatic capture is switched off or
  // when the detector turns out not to work on this machine
  autoCapture = false;
  stopFaceWatch();
  faceStatus.hidden = true;
  instructions.dataset.i18n = "instructions_manual";
  instructions.textContent = t("instructions_manual");
}

function startFaceWatch() {
  if (!autoCapture) {
    faceStatus.hidden = true;
    return;
  }
  stopFaceWatch();
  faceStatus.hidden = false;
  setFaceStatus("face_searching", 0);
  const generation = watchGeneration;
  // give the video element a moment to start delivering frames
  watchTimer = setTimeout(() => detectTick(generation), DETECT_INTERVAL_MS);
}

function stopFaceWatch() {
  watchGeneration += 1;
  if (watchTimer) {
    clearTimeout(watchTimer);
    watchTimer = null;
  }
  anchorFace = null;
  stillSince = null;
  holdBar.hidden = true;
  holdProgress.style.width = "0%";
}

function scheduleNextTick(generation) {
  if (generation !== watchGeneration) {
    return;
  }
  watchTimer = setTimeout(() => detectTick(generation), DETECT_INTERVAL_MS);
}

function detectTick(generation) {
  watchTimer = null;
  if (generation !== watchGeneration || views.camera.hidden || !video.videoWidth) {
    return;
  }

  // draw a small copy of the current frame; low resolution is enough to
  // find a face and keeps the detector fast
  const scale = DETECT_FRAME_WIDTH / video.videoWidth;
  detectCanvas.width = DETECT_FRAME_WIDTH;
  detectCanvas.height = Math.round(video.videoHeight * scale);
  detectCanvas.getContext("2d").drawImage(video, 0, 0, detectCanvas.width, detectCanvas.height);

  detectCanvas.toBlob((blob) => {
    wipeCanvas(detectCanvas);
    if (!blob) {
      scheduleNextTick(generation);
      return;
    }
    sendDetectFrame(blob, generation);
  }, "image/jpeg", 0.75);
}

async function sendDetectFrame(blob, generation) {
  let faces = null;
  const started = Date.now();
  try {
    const formData = new FormData();
    formData.append("image", blob, "frame.jpg");
    const response = await fetch("/detect", { method: "POST", body: formData });
    if (response.ok) {
      const data = await response.json();
      if (data.status === "success") {
        faces = data.faces;
      }
    }
  } catch (err) {
    // the server is busy or unreachable; counted as a failure below
  }

  if (generation !== watchGeneration || views.camera.hidden) {
    return;
  }

  if (faces && Date.now() - started <= DETECT_SLOW_MS) {
    detectFailures = 0;
    handleFaces(faces, generation);
  } else {
    detectFailures += 1;
    if (detectFailures >= MAX_DETECT_FAILURES) {
      console.warn("face detection is failing or too slow; switching to manual capture");
      useManualCapture();
      return;
    }
  }
  if (generation === watchGeneration) {
    scheduleNextTick(generation);
  }
}

function isStill(face) {
  if (!anchorFace) {
    return false;
  }
  const dx = (face.x + face.w / 2) - (anchorFace.x + anchorFace.w / 2);
  const dy = (face.y + face.h / 2) - (anchorFace.y + anchorFace.h / 2);
  const sizeRatio = face.w / anchorFace.w;
  return Math.abs(dx) <= MAX_DRIFT * anchorFace.w
    && Math.abs(dy) <= MAX_DRIFT * anchorFace.h
    && sizeRatio <= MAX_SIZE_CHANGE
    && sizeRatio >= 1 / MAX_SIZE_CHANGE;
}

function handleFaces(faces, generation) {
  const now = Date.now();

  if (faces.length !== 1) {
    anchorFace = null;
    stillSince = null;
    setFaceStatus(faces.length === 0 ? "face_searching" : "multiple_faces", 0);
    return;
  }

  const face = faces[0];
  if (!isStill(face)) {
    // a new face, or the visitor moved: start the hold again
    anchorFace = face;
    stillSince = now;
  }

  const heldFor = now - stillSince;
  setFaceStatus("face_found", heldFor / HOLD_STILL_MS);

  if (heldFor >= HOLD_STILL_MS && generation === watchGeneration) {
    capturePhoto();
  }
}

/* ---------- capture and prediction ---------- */

function capturePhoto() {
  if (captureBtn.disabled || !video.videoWidth) {
    return;
  }
  // no reset timer or face watcher may run while a photo is taken or sent
  clearResetTimer();
  stopFaceWatch();
  showView("loading");
  captureBtn.disabled = true;

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0);

  canvas.toBlob(sendPhoto, "image/jpeg", 0.92);
}

async function sendPhoto(blob) {
  try {
    const formData = new FormData();
    formData.append("image", blob, "photo.jpg");

    const response = await fetch("/predict", {
      method: "POST",
      body: formData
    });

    let data;
    try {
      data = await response.json();
    } catch (err) {
      showError("general_error");
      return;
    }

    if (response.ok && data.status === "success") {
      resultText.textContent = t("result").replace("{age}", data.faceage);
      showView("result");
      scheduleReset();
    } else {
      showError(data.code);
    }
  } catch (err) {
    showError("general_error");
  } finally {
    // the photo is no longer needed once the request has finished
    clearSnapshot();
  }
}

/* ---------- keyboard: Enter or Space presses the button of the current view ---------- */

function handleKeydown(event) {
  if ((event.key !== "Enter" && event.key !== " ") || event.repeat) {
    return;
  }
  // a focused action button (take a photo / try again) already handles
  // Enter and Space itself as a click; any other focused element (e.g. a
  // language button that was just clicked) must not swallow the key
  if (event.target instanceof HTMLButtonElement
      && event.target.classList.contains("primary-btn")) {
    return;
  }
  event.preventDefault();
  if (!views.camera.hidden) {
    capturePhoto();
  } else if (!views.result.hidden || !views.error.hidden) {
    resetApp();
  }
}

document.getElementById("lang-nl").addEventListener("click", () => applyLanguage("nl"));
document.getElementById("lang-en").addEventListener("click", () => applyLanguage("en"));
captureBtn.addEventListener("click", capturePhoto);
document.getElementById("retry-btn").addEventListener("click", resetApp);
document.getElementById("error-retry-btn").addEventListener("click", resetApp);
document.addEventListener("keydown", handleKeydown);

applyLanguage(currentLang);
if (!autoCapture) {
  useManualCapture();
}
startCamera();
