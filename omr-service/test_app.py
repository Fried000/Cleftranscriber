import io
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from xml.etree import ElementTree as ET

from fastapi.testclient import TestClient
from PIL import Image, ImageDraw

from app import app, prepare_crop, recognize
from score import inspect_score

XML = b'''<score-partwise><part id="P1"><measure number="1">
<attributes><divisions>2</divisions><key><fifths>-1</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
<note><pitch><step>B</step><alter>-1</alter><octave>4</octave></pitch><duration>3</duration><type>quarter</type><dot/><tie type="start"/><notations><tied type="start"/><slur type="start" number="1"/></notations></note>
<note><rest/><duration>1</duration><type>eighth</type></note>
<note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><type>half</type></note>
</measure></part></score-partwise>'''


class ScoreTests(unittest.TestCase):
    def test_preserves_xml_pitches_rhythm_keys_and_notation_verbatim(self):
        score = inspect_score(XML)
        self.assertEqual(score['musicXml'].encode(), XML)
        self.assertEqual(score['noteCount'], 2)
        self.assertEqual(score['measureCount'], 1)
        self.assertEqual(score['warnings'], [])

    def test_reports_incomplete_bar_without_inventing_notes(self):
        data = XML.replace(b'<duration>4</duration><type>half</type>', b'<duration>2</duration><type>quarter</type>')
        score = inspect_score(data)
        self.assertEqual(score['musicXml'].encode(), data)
        self.assertIn('measures 1', score['warnings'][0])

    def test_tuplet_and_grace_notation_is_not_reduced_to_duration_names(self):
        data = XML.replace(b'<type>half</type>', b'<type>half</type><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>')
        self.assertEqual(inspect_score(data)['musicXml'].encode(), data)


class UploadTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        token = patch.dict('os.environ', {'OMR_SERVICE_TOKEN': 'test-token'})
        token.start()
        self.addCleanup(token.stop)

    def upload(self, data):
        return self.client.post('/transcribe', headers={'Authorization': 'Bearer test-token'},
                                data={'source_clef': 'treble'}, files={'file': ('score.png', data, 'image/png')})

    def test_invalid_image_returns_readable_error(self):
        response = self.upload(b'not an image')
        self.assertEqual(response.status_code, 400)

    @patch('app.recognize', return_value=(XML, ['3']))
    def test_upload_returns_full_xml_and_engine_uncertainty(self, recognize_image):
        data = io.BytesIO()
        Image.new('RGB', (800, 120), 'white').save(data, format='PNG')
        response = self.upload(data.getvalue())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['musicXml'].encode(), XML)
        self.assertIn('measures 3', response.json()['warnings'][0])
        recognize_image.assert_called_once()


class CropTests(unittest.TestCase):
    def test_scales_staff_spacing_and_keeps_all_systems(self):
        image = Image.new('RGB', (800, 240), 'white')
        draw = ImageDraw.Draw(image)
        for top in (40, 140):
            for line in range(5):
                draw.line((20, top + 8 * line, 780, top + 8 * line), fill='black')
        data = io.BytesIO()
        image.save(data, format='PNG')
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'score.png'
            prepare_crop(data.getvalue(), path)
            with Image.open(path) as prepared:
                self.assertEqual(prepared.size, (2464, 784))

    @patch('app.subprocess.run')
    def test_runs_headless_and_returns_musicxml_with_engine_warnings(self, run):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            executable = root / 'Audiveris.exe'
            executable.touch()
            (root / 'score.musicxml').write_bytes(XML)
            run.return_value = subprocess.CompletedProcess([], 0, 'S1 MeasureStack#3 no correct rhythm', '')
            with patch.dict('os.environ', {'AUDIVERIS_BIN': str(executable)}):
                xml, uncertain = recognize(root / 'score.png', root)
            self.assertEqual(xml, XML)
            self.assertEqual(uncertain, ['3'])
            self.assertIn('-batch', run.call_args.args[0])
            self.assertIn('-export', run.call_args.args[0])


@unittest.skipUnless(os.environ.get('OMR_TEST_IMAGE'), 'Set OMR_TEST_IMAGE to the provided reference screenshot for a real recognition test.')
class ReferenceRecognitionTests(unittest.TestCase):
    def test_opening_bar_matches_reference_pitches_and_eighth_note_rhythm(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / 'output'
            output.mkdir()
            prepare_crop(Path(os.environ['OMR_TEST_IMAGE']).read_bytes(), root / 'score.png')
            xml, _ = recognize(root / 'score.png', output)
            first = ET.fromstring(xml).find('part/measure')
            actual = [(note.findtext('pitch/step', 'R'), note.findtext('pitch/alter', '0'), note.findtext('pitch/octave'), note.findtext('type')) for note in first.findall('note')]
            self.assertEqual(actual, [('C','0','5','eighth'),('R','0',None,'eighth'),('A','0','4','eighth'),('F','0','4','eighth'),('R','0',None,'eighth'),('C','0','5','eighth'),('R','0',None,'eighth'),('B','-1','4','eighth')])


if __name__ == '__main__':
    unittest.main()
