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
    for part in parts:
        divisions, expected = 1, Fraction(4)
        for measure in part.findall('measure'):
            cursor, end = Fraction(0), Fraction(0)
            for event in measure:
                if event.tag == 'attributes':
                    divisions = int(event.findtext('divisions', str(divisions)))
                    time = event.find('time')
                    if time is not None:
                        expected = Fraction(int(time.findtext('beats', '4')) * 4, int(time.findtext('beat-type', '4')))
                elif event.tag == 'backup':
                    cursor -= Fraction(int(event.findtext('duration', '0')), divisions)
                elif event.tag == 'forward':
                    cursor += Fraction(int(event.findtext('duration', '0')), divisions)
                    end = max(end, cursor)
                elif event.tag == 'note' and event.find('grace') is None:
                    duration = Fraction(int(event.findtext('duration', '0')), divisions)
                    if event.find('chord') is None:
                        cursor += duration
                    end = max(end, cursor)
            if measure.get('implicit') != 'yes' and end != expected:
                uncertain.append(measure.get('number', '?'))
    warnings = []
    if uncertain:
        warnings.append('Check the rhythm in measures ' + ', '.join(dict.fromkeys(uncertain)) + '. Recognition did not resolve a complete bar.')
    return {
        'musicXml': musicxml.decode('utf-8'),
        'noteCount': note_count,
        'measureCount': max(len(part.findall('measure')) for part in parts),
        'warnings': warnings,
        'engine': 'Audiveris',
    }
