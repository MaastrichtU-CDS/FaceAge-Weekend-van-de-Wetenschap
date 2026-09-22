# -----------------
# In-memory FaceAge inference for the science fair web service.
#
# The detection and prediction logic is adapted from
# src/test/predict_folder_demo.py so the web service reuses the same
# MTCNN face localization and FaceAge preprocessing steps, but works on
# in-memory image bytes instead of files on disk. Photos are never
# written to disk.
# -----------------

import os
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"

import io
import logging

import numpy as np
import tensorflow as tf
from mtcnn import MTCNN
from PIL import Image

# suppress warnings/errors due to migration from TensorFlow 1.x to 2.x
tf.compat.v1.disable_eager_execution()
tf.compat.v1.logging.set_verbosity(tf.compat.v1.logging.ERROR)


def _scale_sum(inputs, scale=0.1):

    """
    FaceNet/Inception-ResNet scale-sum used by every Lambda layer in the
    FaceAge model: out = inputs[0] + inputs[1] * scale.
    """

    return inputs[0] + inputs[1] * scale


class _FaceAgeLambda(tf.keras.layers.Lambda):
    """Load FaceAge's scale-sum layers without executing Python 3.6 bytecode."""

    @classmethod
    def from_config(cls, config, custom_objects=None):
        if (not config["name"].endswith("_ScaleSum")
                or set(config["arguments"]) != {"scale"}):
            raise ValueError("Unsupported Lambda layer in FaceAge model")
        return cls(_scale_sum, arguments=config["arguments"],
                   output_shape=config["output_shape"], name=config["name"],
                   trainable=config["trainable"], dtype=config["dtype"])

logger = logging.getLogger("faceage")

# input size expected by the FaceAge model
MODEL_INPUT_SIZE = (160, 160)

# very large uploads are downscaled before detection to keep CPU inference fast
MAX_DETECTION_DIMENSION = 1280


class FaceAgePredictor:

    """
    Reusable FaceAge predictor wrapping the MTCNN face detector and the
    pre-trained FaceAge Keras model. Both are loaded once at start-up and
    reused for every request.
    """

    def __init__(self, model_path):

        if not os.path.exists(model_path):
            raise RuntimeError(
                "FaceAge model not found at '%s'. Mount the model file, "
                "e.g. -v \"$PWD/models:/models:ro\"." % model_path)

        # eager execution is disabled (TF 1.x style graph mode, like the
        # original pipeline). Both MTCNN and the FaceAge model build their
        # ops in whichever graph/session is active while they are created,
        # so each gets its own graph and session, captured here and reused
        # explicitly inside the Flask request threads.
        logger.info("Loading MTCNN face detector...")
        self._detector_graph = tf.Graph()
        with self._detector_graph.as_default():
            self._detector_session = tf.compat.v1.Session()
            with self._detector_session.as_default():
                self._detector = MTCNN()

        logger.info("Loading FaceAge model from '%s'...", model_path)
        self._model_graph = tf.Graph()
        with self._model_graph.as_default():
            self._model_session = tf.compat.v1.Session()
            with self._model_session.as_default():
                self._model = tf.keras.models.load_model(
                    model_path, custom_objects={"Lambda": _FaceAgeLambda},
                    compile=False)

        # warm up the model graph once so the first real request is fast
        # (a blank image simply yields "no_face", which is fine)
        self.predict_faceage(self._encode_blank_image())

        logger.info("FaceAge predictor ready.")

    @staticmethod
    def _encode_blank_image():

        """Create in-memory bytes of a blank image for the warm-up run."""

        buffer = io.BytesIO()
        Image.new("RGB", (640, 480)).save(buffer, format="JPEG")
        return buffer.getvalue()

    def predict_faceage(self, image_bytes):

        """
        Run the full FaceAge pipeline on the given in-memory image bytes.

        Returns a dictionary with either
        {"status": "success", "faceage": <rounded age in years>} or
        {"status": "error", "code": "no_face" | "multiple_faces"}.

        Raises ValueError if the bytes cannot be decoded as an image.
        """

        image = self._decode_image(image_bytes)

        # run detection and prediction with their own graph and session,
        # because Flask request threads do not share the main thread's
        # default graph
        with self._detector_graph.as_default():
            with self._detector_session.as_default():
                faces = self._detector.detect_faces(image)

        if len(faces) == 0:
            return {"status": "error", "code": "no_face"}

        if len(faces) > 1:
            return {"status": "error", "code": "multiple_faces"}

        face_input = self._extract_face_input(image, faces[0])

        with self._model_graph.as_default():
            with self._model_session.as_default():
                prediction = np.squeeze(self._model.predict(face_input))

        return {"status": "success", "faceage": int(round(float(prediction)))}

    @staticmethod
    def _decode_image(image_bytes):

        """
        Decode raw image bytes (e.g. JPEG or PNG) into an RGB numpy array.
        Everything happens in memory; no temporary files are created.
        """

        try:
            with Image.open(io.BytesIO(image_bytes)) as pil_image:
                pil_image = pil_image.convert("RGB")

                # downscale unusually large uploads to keep detection fast
                if max(pil_image.size) > MAX_DETECTION_DIMENSION:
                    scale = MAX_DETECTION_DIMENSION / max(pil_image.size)
                    new_size = (max(1, int(pil_image.size[0] * scale)),
                                max(1, int(pil_image.size[1] * scale)))
                    pil_image = pil_image.resize(new_size, Image.LANCZOS)

                return np.asarray(pil_image)
        except Exception:
            raise ValueError("Could not decode the uploaded image.")

    @staticmethod
    def _extract_face_input(image, mtcnn_output_dict):

        """
        Crop the detected face, resize it to the model input size and
        standard-normalize the pixel values, mirroring the original pipeline.
        """

        # extract the bounding box from the detected face
        x1, y1, width, height = mtcnn_output_dict["box"]
        x1, y1 = abs(x1), abs(y1)

        # clamp the bounding box to the image borders
        x1 = min(x1, image.shape[1] - 1)
        y1 = min(y1, image.shape[0] - 1)
        x2 = min(x1 + width, image.shape[1])
        y2 = min(y1 + height, image.shape[0])

        # crop the face
        face = image[y1:y2, x1:x2]

        if face.size == 0:
            raise ValueError("Detected face bounding box is empty.")

        # resize cropped image to the model input size
        face_pil = Image.fromarray(np.uint8(face)).convert("RGB")
        face = np.asarray(face_pil.resize(MODEL_INPUT_SIZE))

        # prep image for TF processing
        mean, std = face.mean(), face.std()
        face = (face - mean) / std

        return face.reshape(1, MODEL_INPUT_SIZE[0], MODEL_INPUT_SIZE[1], 3)
