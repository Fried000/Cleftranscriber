"""Keep the recognized MusicXML intact; inspect it without rebuilding notes."""
from fractions import Fraction
from xml.etree import ElementTree as ET
from zipfile import ZipFile


def read_score(path):
    if path.suffix.lower() != '.mxl':
        return path.read_bytes()
    with ZipFile(path) as archive:
        container = ET.fromstring(archive.read('META-INF/container.xml'))
        rootfile = next((node for node in container.iter() if node.tag.split('}')[-1] == 'rootfile'), None)
        if rootfile is None:
            raise ValueError('The MusicXML archive does not contain a score.')
        return archive.read(rootfile.attrib['full-path'])


def inspect_score(musicxml):
    root = ET.fromstring(musicxml)
    if root.tag != 'score-partwise':
        raise ValueError('Recognition did not return a partwise MusicXML score.')
    parts = root.findall('part')
    if not parts:
        raise ValueError('Recognition did not find a score part.')
    if any(len({n.findtext('staff', '1') for n in part.findall('.//note')}) > 1 for part in parts):
        raise ValueError('This converter supports one staff per part. Select the melody staff for a piano score.')
    note_count = len(root.findall('.//note/pitch'))
    if note_count == 0:
        raise ValueError('No pitched notes were recognized in this image.')
    uncertain = []
    notation_issues = []
    gap_issues = []
    note_lengths = {'maxima': 32, 'long': 16, 'breve': 8, 'whole': 4,
                    'half': 2, 'quarter': 1, 'eighth': Fraction(1, 2),
                    '16th': Fraction(1, 4), '32nd': Fraction(1, 8),
                    '64th': Fraction(1, 16), '128th': Fraction(1, 32),
                    '256th': Fraction(1, 64), '512th': Fraction(1, 128),
                    '1024th': Fraction(1, 256)}
    for part in parts:
        divisions, expected = 1, Fraction(4)
        for measure in part.findall('measure'):
            cursor, end = Fraction(0), Fraction(0)
            previous_onset = Fraction(0)
            for event in measure:
                if event.tag == 'attributes':
                    divisions = int(event.findtext('divisions', str(divisions)))
                    time = event.find('time')
                    if time is not None:
                        pairs = list(time)
                        expected = Fraction(0)
                        beats = None
                        for item in pairs:
                            if item.tag == 'beats':
                                beats = sum(int(value) for value in item.text.split('+'))
                            elif item.tag == 'beat-type' and beats is not None:
                                expected += Fraction(beats * 4, int(item.text))
                                beats = None
                        if time.find('senza-misura') is not None:
                            expected = None
                elif event.tag == 'backup':
                    cursor -= Fraction(int(event.findtext('duration', '0')), divisions)
                elif event.tag == 'forward':
                    cursor += Fraction(int(event.findtext('duration', '0')), divisions)
                    end = max(end, cursor)
                    gap_issues.append(measure.get('number', '?'))
                elif event.tag == 'note' and event.find('grace') is None:
                    duration = Fraction(int(event.findtext('duration', '0')), divisions)
                    if event.find('chord') is None:
                        previous_onset = cursor
                        cursor += duration
                    end = max(end, previous_onset + duration)
                    # Validate the printed rhythm as well as the bar's total.
                    # A full bar can still contain contradictory note/rest types.
                    kind = event.findtext('type')
                    if kind in note_lengths and event.find('rest[@measure="yes"]') is None:
                        written = Fraction(note_lengths[kind])
                        written *= sum((Fraction(1, 2 ** dot) for dot in range(len(event.findall('dot')) + 1)), Fraction(0))
                        tuplet = event.find('time-modification')
                        if tuplet is not None:
                            written *= Fraction(int(tuplet.findtext('normal-notes', '1')), int(tuplet.findtext('actual-notes', '1')))
                        if written != duration:
                            notation_issues.append(measure.get('number', '?'))
                    elif kind is None and event.find('rest[@measure="yes"]') is None:
                        notation_issues.append(measure.get('number', '?'))
            if expected is not None and measure.get('implicit') != 'yes' and end != expected:
                uncertain.append(measure.get('number', '?'))
    warnings = []
    if uncertain:
        warnings.append('Check the rhythm in measures ' + ', '.join(dict.fromkeys(uncertain)) + '. Recognition did not resolve a complete bar.')
    if notation_issues:
        warnings.append('Check note lengths, dots and rests in measures ' + ', '.join(dict.fromkeys(notation_issues)) + '. Printed rhythm does not match the recognized timing or is missing.')
    if gap_issues:
        warnings.append('Check rests and voices in measures ' + ', '.join(dict.fromkeys(gap_issues)) + '. Recognition contains time gaps without explicit rests; these can also occur in multiple voices.')
    return {
        'musicXml': musicxml.decode('utf-8'),
        'noteCount': note_count,
        'measureCount': max(len(part.findall('measure')) for part in parts),
        'warnings': warnings,
        'engine': 'Audiveris',
    }
