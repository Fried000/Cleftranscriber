import { Accidental, Barline, Dot, Formatter, Renderer, Stave, StaveNote, Voice } from 'vexflow/bravura';
import type { Clef } from './App';

export type NoteEvent = {
  pitches: string[];
  duration: string;
  rest: boolean;
};

export type ScoreTranscription = {
  timeSignature: string;
  measures: { notes: NoteEvent[] }[];
};

const DURATIONS: Record<string, string> = {
  whole: 'w',
  half: 'h',
  quarter: 'q',
  eighth: '8',
  sixteenth: '16',
  thirty_second: '32',
  sixty_fourth: '64',
  dotted_whole: 'wd',
  dotted_half: 'hd',
  dotted_quarter: 'qd',
  dotted_eighth: '8d',
  dotted_sixteenth: '16d',
  dotted_thirty_second: '32d',
  dotted_sixty_fourth: '64d',
};

const DURATION_WIDTH: Record<string, number> = {
  whole: 38,
  half: 34,
  quarter: 30,
  eighth: 35,
  sixteenth: 41,
  thirty_second: 47,
};

function vexKey(pitch: string) {
  const match = pitch.match(/^([A-G])(#{1,2}|b{1,2}|B{1,2})?(-?\d+)$/);
  if (!match) throw new Error(`Unrecognized pitch: ${pitch}`);
  const accidental = match[2]?.replace(/B/g, 'b') ?? '';
  return `${match[1].toLowerCase()}${accidental}/${match[3]}`;
}

export async function renderTranscription(score: ScoreTranscription, clef: Clef): Promise<Blob> {
  await document.fonts.ready;
  const width = 1400;
  const sideMargin = 40;
  const contentWidth = width - sideMargin * 2;
  const measures = score.measures.length ? score.measures : [{ notes: [] }];
  const [numBeats, beatValue] = score.timeSignature.split('/').map(Number);
  if (!numBeats || !beatValue) throw new Error(`Invalid time signature: ${score.timeSignature}`);

  const preferredMeasureWidth = (measure: ScoreTranscription['measures'][number]) => {
    const notesWidth = measure.notes.reduce((total, note) => {
      const baseDuration = note.duration.replace(/^dotted_/, '');
      const durationWidth = DURATION_WIDTH[baseDuration] ?? 34;
      const dotWidth = note.duration.startsWith('dotted_') ? 9 : 0;
      const chordWidth = Math.max(0, note.pitches.length - 1) * 9;
      return total + durationWidth + dotWidth + chordWidth + 13;
    }, 36);
    return Math.max(135, notesWidth);
  };

  const systems: { measureIndexes: number[]; widths: number[]; usedWidth: number }[] = [];
  let currentSystem = { measureIndexes: [] as number[], widths: [] as number[], usedWidth: 0 };
  for (let index = 0; index < measures.length; index++) {
    const firstInSystem = currentSystem.measureIndexes.length === 0;
    const preferredWidth = preferredMeasureWidth(measures[index]) + (firstInSystem ? 90 : 0);
    if (!firstInSystem && currentSystem.usedWidth + preferredWidth > contentWidth) {
      systems.push(currentSystem);
      currentSystem = { measureIndexes: [], widths: [], usedWidth: 0 };
    }

    const widthWithClef = preferredMeasureWidth(measures[index]) + (currentSystem.measureIndexes.length === 0 ? 90 : 0);
    const measureWidth = Math.min(contentWidth, widthWithClef);
    currentSystem.measureIndexes.push(index);
    currentSystem.widths.push(measureWidth);
    currentSystem.usedWidth += measureWidth;
  }
  if (currentSystem.measureIndexes.length) systems.push(currentSystem);

  const bottomPitch = { treble: 4 * 7 + 2, bass: 2 * 7 + 4, alto: 3 * 7 + 3, tenor: 3 * 7 + 1 }[clef];
  let nextSystemTop = 110;
  const systemPositions = systems.map((system) => {
    let minOffset = 10;
    let maxOffset = 130;
    for (const index of system.measureIndexes) {
      for (const note of measures[index].notes) {
        if (note.rest) continue;
        for (const pitch of note.pitches) {
          const match = pitch.match(/^([A-G])(?:#{1,2}|b{1,2}|B{1,2})?(-?\d+)$/);
          if (!match) continue;
          const position = Number(match[2]) * 7 + 'CDEFGAB'.indexOf(match[1]) - bottomPitch;
          const noteOffset = 80 - position * 5;
          minOffset = Math.min(minOffset, noteOffset - 55);
          maxOffset = Math.max(maxOffset, noteOffset + 55);
        }
      }
    }
    const y = nextSystemTop - minOffset;
    nextSystemTop = y + maxOffset + 70;
    return y;
  });
  const height = nextSystemTop;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const renderer = new Renderer(canvas, Renderer.Backends.CANVAS);
  renderer.resize(width, height);
  const context = renderer.getContext();
  const background = canvas.getContext('2d');
  if (!background) throw new Error('Your browser could not create the score image.');
  background.fillStyle = '#fff';
  background.fillRect(0, 0, width, height);
  background.fillStyle = '#26312f';
  background.font = '600 22px Georgia, serif';
  background.fillText('Transcribed score', 44, 40);
  background.fillStyle = '#6f7b77';
  background.font = '14px Arial, sans-serif';
  background.fillText(`${clef.toUpperCase()} clef · ${score.timeSignature} · ${measures.length} measures`, 44, 66);
  context.setFillStyle('#151a19');
  context.setStrokeStyle('#151a19');

  const drawRhythmWarning = (x: number, y: number, measureWidth: number) => {
    background.save();
    background.strokeStyle = '#c43d35';
    background.lineWidth = 2;
    background.strokeRect(x + 2, y - 14, measureWidth - 4, 112);
    background.fillStyle = '#c43d35';
    background.beginPath();
    background.moveTo(x + measureWidth - 23, y - 14);
    background.lineTo(x + measureWidth - 3, y - 14);
    background.lineTo(x + measureWidth - 3, y + 6);
    background.closePath();
    background.fill();
    background.fillStyle = '#fff';
    background.font = 'bold 13px Arial, sans-serif';
    background.fillText('!', x + measureWidth - 11, y + 1);
    background.restore();
  };

  systems.forEach((system, systemIndex) => {
    let x = sideMargin;
    system.measureIndexes.forEach((measureIndex, measureInSystem) => {
    const measure = measures[measureIndex];
    const measureWidth = system.widths[measureInSystem];
    const isFirstInSystem = measureInSystem === 0;
    const y = systemPositions[systemIndex];
    const stave = new Stave(x, y, measureWidth);
    stave.setBegBarType(isFirstInSystem ? Barline.type.SINGLE : Barline.type.NONE);
    stave.setEndBarType(Barline.type.SINGLE);
    if (isFirstInSystem) stave.addClef(clef).addTimeSignature(score.timeSignature);
    stave.setContext(context).draw();

    const staveNotes = measure.notes.map((note) => {
      const duration = DURATIONS[note.duration];
      if (!duration) throw new Error(`Unsupported note duration: ${note.duration}`);
      const keys = note.rest ? ['b/4'] : note.pitches.map(vexKey);
      const staveNote = new StaveNote({ keys, duration: note.rest ? `${duration}r` : duration, clef });
      if (note.duration.startsWith('dotted_')) Dot.buildAndAttach([staveNote], { all: true });
      if (!note.rest) {
        note.pitches.forEach((pitch, pitchIndex) => {
          const accidental = pitch.match(/^[A-G](#{1,2}|b{1,2}|B{1,2})/)?.[1];
          if (accidental) staveNote.addModifier(new Accidental(accidental.replace(/B/g, 'b')), pitchIndex);
        });
      }
      return staveNote;
    });
    if (staveNotes.length === 0) {
      drawRhythmWarning(x, y, measureWidth);
      x += measureWidth;
      return;
    }
    const voice = new Voice({ numBeats, beatValue }).setMode(Voice.Mode.SOFT).addTickables(staveNotes);
    const durationMatches = voice.getTicksUsed().equals(voice.getTotalTicks());
    const formatter = new Formatter();
    formatter.joinVoices([voice]).formatToStave([voice], stave);
    voice.draw(context, stave);
    if (!durationMatches) drawRhythmWarning(x, y, measureWidth);
    x += measureWidth;
    });
  });

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not export the transcribed score.')), 'image/png');
  });
}
