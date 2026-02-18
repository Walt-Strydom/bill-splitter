"""
Bill Splitter ZAR – Tesseract OCR Microservice
Accepts a base64-encoded image and returns the extracted text lines.
"""
import base64
import io
import logging

import pytesseract
from flask import Flask, jsonify, request
from PIL import Image, ImageEnhance, ImageFilter

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
app = Flask(__name__)

# Tesseract config tuned for receipt text:
#   --oem 3  = LSTM neural-net engine
#   --psm 6  = Assume a single uniform block of text
TESS_CONFIG = "--oem 3 --psm 6"


def preprocess(img: Image.Image) -> Image.Image:
    """
    Receipt-specific preprocessing steps that reliably improve OCR accuracy:
    1. Convert to greyscale     – remove colour noise
    2. Boost contrast           – make text stand out from background
    3. Sharpen                  – clean up blurry edges from phone cameras
    """
    img = img.convert("L")
    img = ImageEnhance.Contrast(img).enhance(2.0)
    img = img.filter(ImageFilter.SHARPEN)
    return img


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


@app.route("/ocr", methods=["POST"])
def ocr():
    data = request.get_json(force=True, silent=True) or {}
    img_b64 = data.get("image_base64", "")

    if not img_b64:
        return jsonify({"error": "image_base64 is required"}), 400

    try:
        img_bytes = base64.b64decode(img_b64)
    except Exception:
        return jsonify({"error": "image_base64 is not valid base64"}), 400

    try:
        img = Image.open(io.BytesIO(img_bytes))
    except Exception as exc:
        return jsonify({"error": f"Cannot decode image: {exc}"}), 400

    try:
        img = preprocess(img)
        text = pytesseract.image_to_string(img, config=TESS_CONFIG)
    except Exception as exc:
        logging.exception("Tesseract error")
        return jsonify({"error": f"OCR failed: {exc}"}), 500

    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    logging.info("OCR completed: %d lines extracted", len(lines))

    return jsonify({"text": text, "lines": lines})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
