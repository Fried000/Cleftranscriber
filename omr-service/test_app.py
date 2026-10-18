import io
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from xml.etree import ElementTree as ET

from fastapi.testclient import TestClient
from fastapi import HTTPException
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

    def test_flags_wrong_rest_symbol_even_when_bar_adds_up(self):
        data = XML.replace(b'<rest/><duration>1</duration><type>eighth</type>',
                           b'<rest/><duration>1</duration><type>quarter</type>')
        result = inspect_score(data)
        self.assertTrue(any('Printed rhythm' in warning for warning in result['warnings']))
        self.assertEqual(result['musicXml'].encode(), data)

    def test_valid_tuplets_are_not_flagged(self):
        notes = b''.join(b'<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>eighth</type><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification></note>' for _ in range(12))
        data = b'<score-partwise><part id="P1"><measure number="1"><attributes><divisions>3</divisions></attributes>' + notes + b'</measure></part></score-partwise>'
        self.assertEqual(inspect_score(data)['warnings'], [])

    def test_flags_missing_rest_represented_as_forward(self):
        data = XML.replace(b'<note><rest/><duration>1</duration><type>eighth</type></note>',
                           b'<forward><duration>1</duration></forward>')
        self.assertTrue(any('time gaps' in warning for warning in inspect_score(data)['warnings']))

    def test_additive_time_signature(self):
        data = XML.replace(b'<beats>4</beats><beat-type>4</beat-type>', b'<beats>3+5</beats><beat-type>8</beat-type>')
        self.assertEqual(inspect_score(data)['warnings'], [])

    def test_chord_longer_than_first_note_counts_toward_bar_end(self):
        data = b'''<score-partwise><part id="P1"><measure number="1">
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
        <note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
        </measure></part></score-partwise>'''
        self.assertEqual(inspect_score(data)['warnings'], [])


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

    def test_does_not_shrink_large_page_and_small_rest_details(self):
        image = Image.new('RGB', (6100, 150), 'white')
        data = io.BytesIO()
        image.save(data, format='PNG')
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'score.png'
            prepare_crop(data.getvalue(), path)
            with Image.open(path) as prepared:
                self.assertEqual(prepared.size, (6164, 214))

    @patch('app.subprocess.run')
    def test_distinguishes_missing_exports_from_split_scores(self, run):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            executable = root / 'Audiveris.exe'
            executable.touch()
            run.return_value = subprocess.CompletedProcess([], 0, '', '')
            with patch.dict('os.environ', {'AUDIVERIS_BIN': str(executable)}):
                with self.assertRaises(HTTPException) as missing:
                    recognize(root / 'score.png', root)
                self.assertIn('could not export', missing.exception.detail)
                (root / 'one.musicxml').write_bytes(XML)
                (root / 'two.musicxml').write_bytes(XML)
                with self.assertRaises(HTTPException) as split:
                    recognize(root / 'score.png', root)
                self.assertIn('2 separate scores', split.exception.detail)

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
