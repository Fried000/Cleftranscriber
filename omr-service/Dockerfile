FROM python:3.11-slim-bookworm

ARG AUDIVERIS_VERSION=5.11.0

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    AUDIVERIS_BIN=/opt/audiveris/bin/Audiveris \
    TESSDATA_PREFIX=/usr/share/tesseract-ocr/5/tessdata

WORKDIR /app

# Audiveris 5.11 requires legacy OCR data rather than Debian's LSTM-only eng package.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates fontconfig tesseract-ocr-eng \
    && curl -fsSL "https://github.com/Audiveris/audiveris/releases/download/${AUDIVERIS_VERSION}/Audiveris-${AUDIVERIS_VERSION}-ubuntu22.04-x86_64.deb" -o /tmp/audiveris.deb \
    && apt-get install -y --no-install-recommends /tmp/audiveris.deb \
    && curl -fsSL https://raw.githubusercontent.com/tesseract-ocr/tessdata/ced78752cc61322fb554c280d13360b35b8684e4/eng.traineddata -o /usr/share/tesseract-ocr/5/tessdata/eng.traineddata \
    && echo 'daa0c97d651c19fba3b25e81317cd697e9908c8208090c94c3905381c23fc047  /usr/share/tesseract-ocr/5/tessdata/eng.traineddata' | sha256sum -c - \
    && rm /tmp/audiveris.deb \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py score.py ./

EXPOSE 8001
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8001"]
