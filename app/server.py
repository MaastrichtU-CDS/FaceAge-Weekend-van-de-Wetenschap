# -----------------
# Flask web server for the FaceAge science fair booth.
#
# Serves a small bilingual (NL/EN) webcam page and a POST /predict
# endpoint that estimates FaceAge from a single photo. Photos are
# processed fully in memory and are never written to disk, a database
# or the logs.
# -----------------

import os
import logging
import threading

from flask import Flask, jsonify, render_template, request
from werkzeug.exceptions import RequestEntityTooLarge

from inference import FaceAgePredictor

MODEL_PATH = os.environ.get("FACEAGE_MODEL_PATH", "/models/faceage_model.h5")

# webcam JPEG snapshots are typically a few hundred KB; reject unusual uploads
MAX_IMAGE_BYTES = 10 * 1024 * 1024

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_IMAGE_BYTES

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("faceage")

# load the detector and model once at start-up
predictor = FaceAgePredictor(MODEL_PATH)

# serialize predictions so concurrent requests cannot corrupt the TF graph
prediction_lock = threading.Lock()


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/predict", methods=["POST"])
def predict():

    upload = request.files.get("image")

    if upload is None:
        return jsonify({"status": "error", "code": "invalid_image"}), 400

    # read the photo into memory only; it is never stored anywhere
    image_bytes = upload.read()

    try:
        with prediction_lock:
            result = predictor.predict_faceage(image_bytes)
    except ValueError:
        logger.info("invalid image received")
        return jsonify({"status": "error", "code": "invalid_image"}), 400
    except Exception:
        logger.exception("prediction failed")
        return jsonify({"status": "error", "code": "prediction_failed"}), 500

    if result["status"] == "success":
        logger.info("prediction completed")
    else:
        logger.info("prediction returned: %s", result["code"])

    return jsonify(result)


@app.errorhandler(RequestEntityTooLarge)
def handle_too_large(_error):
    return jsonify({"status": "error", "code": "invalid_image"}), 400


if __name__ == "__main__":
    # local booth usage; threaded so the UI stays responsive
    app.run(host="0.0.0.0", port=8000, threaded=True)
