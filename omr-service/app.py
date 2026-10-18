import hmac
import logging
import os
import re
import shutil
import subprocess
import tempfile
from io import BytesIO
from pathlib import Path

import numpy as np
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError

from score import inspect_score, read_score

app = FastAPI(title='Clef Transcriber OMR')
MAX_FILE_SIZE = 10 * 1024 * 1024
ALLOWED_TYPES = {'image/png', 'image/jpeg', 'image/webp'}
logger = logging.getLogger('uvicorn.error')


def prepare_crop(image_data, image_path):
    with Image.open(BytesIO(image_data)) as original:
        image = ImageOps.exif_transpose(original).convert('RGBA')
        paper = Image.new('RGBA', image.size, 'white')
        paper.alpha_composite(image)
        image = paper.convert('RGB')
        # Normalize staff spacing instead of shrinking a whole page to the
        # pixel budget of a single staff. Keep every system on the page.
        ink = np.asarray(image.convert('L')) < 128
        projection = ink.sum(axis=1)
        rows = np.flatnonzero(projection > max(image.width * .25, projection.max() * .6))
        groups = np.split(rows, np.where(np.diff(rows) > 1)[0] + 1)
        centers = np.array([group.mean() for group in groups if len(group)])
        gaps = np.diff(centers)
        gaps = gaps[(gaps >= 3) & (gaps <= 40)]
        spacing = float(np.median(gaps)) if len(gaps) >= 4 else 12
        # Cap enlargement, but never shrink a high-resolution source page:
        # downsampling can erase eighth-rest hooks, dots and flags.
        scale = max(1, min(4, 24 / spacing, 6000 / max(image.size)))
        image = image.resize((max(1, round(image.width * scale)), max(1, round(image.height * scale))), Image.Resampling.LANCZOS)
        ImageOps.expand(image, border=32, fill='white').save(image_path, format='PNG')


def recognize(image_path, output_dir):
    executable = os.environ.get('AUDIVERIS_BIN') or shutil.which('audiveris') or shutil.which('Audiveris')
    if not executable or not Path(executable).is_file():
        raise HTTPException(status_code=503, detail='Audiveris is not available. Rebuild the OMR container or set AUDIVERIS_BIN to its executable.')
    music_font = os.environ.get('OMR_MUSIC_FONT', 'Leland')
    if music_font not in {'Bravura', 'Leland', 'Primus', 'FinaleJazz', 'JazzPerc'}:
        raise HTTPException(status_code=503, detail='OMR_MUSIC_FONT is not a supported Audiveris font.')
    try:
        result = subprocess.run([executable, '-batch', '-constant', f'org.audiveris.omr.ui.symbol.MusicFont.defaultMusicFamily={music_font}',
                                 # Short, aliased beams in screenshots otherwise lose to quarter-note stems.
                                 '-constant', 'org.audiveris.omr.sheet.beam.BeamsBuilder.minBeamWidthHigh=2.0',
                                 '-constant', 'org.audiveris.omr.sheet.beam.BeamsBuilder.maxJitterRatio=0.05',
                                 '-transcribe', '-export', '-output', str(output_dir), '--', str(image_path)],
                                check=False, capture_output=True, text=True, encoding='utf-8', errors='replace',
                                timeout=int(os.environ.get('OMR_TIMEOUT_SECONDS', '270')),
                                creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    except subprocess.TimeoutExpired as error:
        raise HTTPException(status_code=504, detail='Recognition took too long. Select fewer complete staff systems and try again.') from error
    logs = result.stdout + result.stderr
    if result.returncode:
        logger.warning('Audiveris failed: %s', logs[-6000:])
        raise HTTPException(status_code=422, detail='The notation could not be read. Include complete staff systems and their clefs in the image.')
    files = sorted(output_dir.rglob('*.mxl')) or sorted(output_dir.rglob('*.musicxml'))
    if not files:
        logger.warning('Audiveris produced no score export: %s', logs[-6000:])
        raise HTTPException(status_code=422, detail='The recognition engine could not export a score from this image. Try one complete staff system with its clef and time signature, at the original image resolution.')
    if len(files) > 1:
        logger.warning('Audiveris split the image into %d score exports.', len(files))
        raise HTTPException(status_code=422, detail=f'The recognition engine split this image into {len(files)} separate scores. Upload one continuous score or crop one complete staff system at a time.')
    uncertain = sorted(set(re.findall(r'MeasureStack#(\d+) no correct rhythm', logs)), key=int)
    return read_score(files[0]), uncertain


@app.get('/health')
def health():
    return {'status': 'ok', 'engine': 'Audiveris'}


@app.post('/transcribe')
def transcribe(file: UploadFile = File(...), source_clef: str = Form(...), authorization: str | None = Header(default=None)):
    expected_token = os.environ.get('OMR_SERVICE_TOKEN', '')
    if not expected_token:
        raise HTTPException(status_code=503, detail='OMR_SERVICE_TOKEN is not configured.')
    if not authorization or not hmac.compare_digest(authorization, f'Bearer {expected_token}'):
        raise HTTPException(status_code=401, detail='Invalid OMR service token.')
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=415, detail='Use a PNG, JPG, JPEG, or WEBP image.')
    if source_clef not in {'treble', 'bass', 'alto', 'tenor'}:
        raise HTTPException(status_code=400, detail='Select a valid source clef.')
    data = file.file.read(MAX_FILE_SIZE + 1)
    if not data:
        raise HTTPException(status_code=400, detail='The image is empty.')
    if len(data) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail='The image exceeds 10 MB.')
    try:
        with tempfile.TemporaryDirectory(prefix='clef-omr-') as directory:
            image_path = Path(directory) / 'score.png'
            output_dir = Path(directory) / 'output'
            output_dir.mkdir()
            try:
                prepare_crop(data, image_path)
            except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as error:
                raise HTTPException(status_code=400, detail='The uploaded file could not be opened as a score image.') from error
            musicxml, uncertain = recognize(image_path, output_dir)
            try:
                result = inspect_score(musicxml)
            except ValueError as error:
                raise HTTPException(status_code=422, detail=str(error)) from error
            if uncertain:
                result['warnings'].append('The recognition engine could not resolve rhythm in measures ' + ', '.join(uncertain) + '. Check these against the source.')
            return result
    except HTTPException:
        raise
    except Exception as error:
        logger.exception('OMR service failed')
        raise HTTPException(status_code=500, detail='OMR service failed while processing this image.') from error
