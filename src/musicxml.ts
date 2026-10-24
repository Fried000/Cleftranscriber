import type { Clef } from './App';

export type RecognizedScore = {
  musicXml: string;
  noteCount: number;
  measureCount: number;
  warnings: string[];
  engine: string;
};

export function changeClef(musicXml: string, target: Clef, octaveShift = 0): string {
  const xml = new DOMParser().parseFromString(musicXml, 'application/xml');
  if (xml.querySelector('parsererror') || xml.documentElement.localName !== 'score-partwise') {
    throw new Error('Recognition returned unreadable MusicXML.');
  }
  if (!Number.isInteger(octaveShift) || Math.abs(octaveShift) > 3) throw new Error('Choose an octave shift between −3 and +3.');
  const [sign, line] = { treble: ['G', '2'], bass: ['F', '4'], alto: ['C', '3'], tenor: ['C', '4'] }[target];
  for (const part of xml.querySelectorAll('score-partwise > part')) {
    let clefs = Array.from(part.querySelectorAll('attributes > clef'));
    if (clefs.length === 0) {
      const measure = part.querySelector('measure');
      if (!measure) continue;
      let attributes = measure.querySelector('attributes');
      if (!attributes) {
        attributes = xml.createElement('attributes');
        measure.prepend(attributes);
      }
      const clef = xml.createElement('clef');
      attributes.append(clef);
      clefs = [clef];
    }
    for (const clef of clefs) {
      clef.replaceChildren();
      const signNode = xml.createElement('sign');
      signNode.textContent = sign;
      const lineNode = xml.createElement('line');
      lineNode.textContent = line;
      clef.append(signNode, lineNode);
    }
  }
  for (const octave of xml.querySelectorAll('note > pitch > octave')) {
    const shifted = Number(octave.textContent) + octaveShift;
    if (!Number.isInteger(shifted) || shifted < 0 || shifted > 9) {
      throw new Error('This octave shift puts notes outside the supported pitch range. Choose a smaller shift.');
    }
    octave.textContent = String(shifted);
  }
  // Imported coordinates belong to the source clef. Re-engrave notes and rests.
  for (const note of xml.querySelectorAll('note')) {
    for (const attribute of ['default-x', 'default-y', 'relative-x', 'relative-y']) note.removeAttribute(attribute);
    for (const position of note.querySelectorAll('rest > display-step, rest > display-octave, stem')) position.remove();
  }
  // Preserve grace/cue tags, articulations, ornaments, tuplets, durations,
  // accidentals, beams, voices, ties and slurs. Grace notes shift with the rest.
  return new XMLSerializer().serializeToString(xml);
}

export async function renderMusicXml(musicXml: string, clef: Clef, octaveShift = 0): Promise<Blob> {
  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
  const host = document.createElement('div');
  Object.assign(host.style, { position: 'absolute', left: '-100000px', top: '0', width: '1400px' });
  document.body.append(host);
  try {
    const display = new OpenSheetMusicDisplay(host, {
      backend: 'canvas', autoResize: false, pageFormat: 'Endless',
      drawTitle: false, drawComposer: false, drawPartNames: false,
      drawCredits: false, drawMeasureNumbers: true,
      newSystemFromXML: true, autoBeam: false,
      setWantedStemDirectionByXml: false, pageBackgroundColor: '#ffffff',
    });
    await display.load(changeClef(musicXml, clef, octaveShift));
    await document.fonts.ready;
    display.render();
    const pages = Array.from(host.querySelectorAll('canvas'));
    if (!pages.length) throw new Error('Could not engrave the recognized MusicXML.');
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(...pages.map((page) => page.width));
    canvas.height = pages.reduce((height, page) => height + page.height, 0);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not create the score image.');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    let y = 0;
    for (const page of pages) {
      context.drawImage(page, 0, y);
      y += page.height;
    }
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not export the score image.')), 'image/png');
    });
  } finally {
    host.remove();
  }
}
