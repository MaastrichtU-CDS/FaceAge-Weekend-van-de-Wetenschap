"""Run with FACEAGE_MODEL_PATH set; optionally pass a single-face photo path."""

import io
import platform
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import tensorflow as tf

from server import app, predictor


def check():
    # Run from a request thread: TensorFlow graphs are created at import time.
    with app.test_client() as client:
        assert client.get("/").status_code == 200
        blank = predictor._encode_blank_image()
        response = client.post("/predict", data={"image": (io.BytesIO(blank), "blank.jpg")})
        assert response.json == {"status": "error", "code": "no_face"}, response.json
        response = client.post("/predict", data={"image": (io.BytesIO(b"invalid"), "bad.jpg")})
        assert response.status_code == 400, response.json

        # A blank photo skips FaceAge, so also exercise the actual model weights.
        sample = np.random.default_rng(0).normal(size=(1, 160, 160, 3)).astype("float32")
        with predictor._model_graph.as_default(), predictor._model_session.as_default():
            estimate = predictor._model.predict(sample, verbose=0)
            assert estimate.shape == (1, 1) and np.isfinite(estimate).all(), estimate
            for layer in predictor._model.layers[0].layers:
                if layer.name.endswith("_ScaleSum"):
                    value = layer.function([2.0, 3.0], **layer.arguments)
                    assert value == 2.0 + 3.0 * layer.arguments["scale"]

        if len(sys.argv) > 1:
            photo = Path(sys.argv[1]).read_bytes()
            response = client.post("/predict", data={"image": (io.BytesIO(photo), "face.jpg")})
            assert response.status_code == 200 and response.json["status"] == "success", response.json
            assert isinstance(response.json["faceage"], int), response.json
            print("Face prediction:", response.json)
        print(f"Passed: TensorFlow {tf.__version__}, {platform.machine()}, model output {estimate.item():.6f}")


if __name__ == "__main__":
    with ThreadPoolExecutor(max_workers=1) as executor:
        executor.submit(check).result()
