/*
 * FaceAge science fair booth interface.
 *
 * Handles the webcam stream, photo capture, language switching and the
 * automatic reset timer. Photos are turned into an in-memory blob, sent
 * to /predict and then discarded. Nothing is stored in localStorage,
 * sessionStorage or browser downloads.
 */

"use strict";

// all visible UI texts, kept at B1 level
const TEXTS = {
  nl: {
    welcome: "Welkom! Maak een foto met de camera.",
    instructions: "Kijk recht in de camera. Zorg dat je alleen op de foto staat.",
    capture: "Neem een foto",
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
    welcome: "Welcome! Take a photo with the camera.",
    instructions: "Look straight at the camera. Make sure you are the only person in the photo.",
    capture: "Take a photo",
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

// Dutch is the default language; the choice is kept (in memory only)
// so the next visitor sees the same language
let currentLang = "nl";

let stream = null;
let resetTimer = null;

const views = {
  camera: document.getElementById("view-camera"),
  loading: document.getElementById("view-loading"),
  result: document.getElementById("view-result"),
  error: document.getElementById("view-error")
};

const video = document.getElementById("webcam");
const canvas = document.getElementById("snapshot");
const captureBtn = document.getElementById("capture-btn");
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
    captureBtn.disabled = false;
  } catch (err) {
    showError("camera_error");
  }
}

function stopCamera() {
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

function clearSnapshot() {
  // wipe the photo from the in-memory canvas
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  canvas.width = 0;
  canvas.height = 0;
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
  errorText.textContent = t(code) || t("general_error");
  showView("error");
  scheduleReset();
}

function capturePhoto() {
  // no reset timer may run while a photo is being taken or sent
  clearResetTimer();
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

document.getElementById("lang-nl").addEventListener("click", () => applyLanguage("nl"));
document.getElementById("lang-en").addEventListener("click", () => applyLanguage("en"));
captureBtn.addEventListener("click", capturePhoto);
document.getElementById("retry-btn").addEventListener("click", resetApp);
document.getElementById("error-retry-btn").addEventListener("click", resetApp);

applyLanguage(currentLang);
startCamera();
