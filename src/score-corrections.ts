const lengths: Record<string, [number, number]> = {
  whole: [4, 1], half: [2, 1], quarter: [1, 1], eighth: [1, 2],
  '16th': [1, 4], '32nd': [1, 8], '64th': [1, 16],
};
export type MeasureEdit = {
  fifths?: number; beats?: string; beatType?: number; tempo?: number;
  note?: { index: number; type: string; dots: number; grace: boolean; separate: boolean };
  addGrace?: { before: number; step: string; octave: number; alter: number; type: 'eighth' | '16th' };
};

function orderedChild(document: XMLDocument, parent: Element, tag: string, order: string[]) {
  const existing = Array.from(parent.children).find(child => child.localName === tag);
  if (existing) return existing;
  const node = document.createElement(tag);
  const before = Array.from(parent.children).find(child => order.indexOf(child.localName) > order.indexOf(tag));
  parent.insertBefore(node, before || null);
  return node;
}

export function correctMeasure(source: string, partId: string, measureIndex: number, edit: MeasureEdit): string {
  const xml = new DOMParser().parseFromString(source, 'application/xml');
  if (xml.querySelector('parsererror')) throw new Error('The score XML could not be read.');
  const part = Array.from(xml.querySelectorAll('score-partwise > part')).find(p => p.getAttribute('id') === partId);
  const measures = part ? Array.from(part.children).filter(child => child.localName === 'measure') : [];
  const measure = measures[measureIndex];
  if (!part || !measure) throw new Error('Choose a score part and measure.');
  const attributes = () => orderedChild(xml, measure, 'attributes', ['print', 'attributes', 'direction', 'note']);
  const attributeOrder = ['divisions', 'key', 'time', 'staves', 'part-symbol', 'instruments', 'clef', 'staff-details'];
  if (edit.fifths !== undefined) {
    if (!Number.isInteger(edit.fifths) || Math.abs(edit.fifths) > 7) throw new Error('Choose a key between seven flats and seven sharps.');
    const key = orderedChild(xml, attributes(), 'key', attributeOrder);
    key.setAttribute('print-object', 'yes');
    orderedChild(xml, key, 'fifths', ['cancel', 'fifths', 'mode']).textContent = String(edit.fifths);
  }
  if (edit.beats !== undefined || edit.beatType !== undefined) {
    if (!edit.beats || !/^\d+(\+\d+)*$/.test(edit.beats) || edit.beats.split('+').some(value => Number(value) < 1 || Number(value) > 64) || ![1, 2, 4, 8, 16, 32, 64].includes(edit.beatType!)) {
      throw new Error('Enter a time signature such as 3/4, 6/8, or 3+2/8.');
    }
    const time = orderedChild(xml, attributes(), 'time', attributeOrder);
    time.removeAttribute('symbol');
    time.setAttribute('print-object', 'yes');
    time.replaceChildren();
    for (const [tag, value] of [['beats', edit.beats], ['beat-type', String(edit.beatType)]]) {
      const child = xml.createElement(tag); child.textContent = value; time.append(child);
    }
  }
  if (edit.tempo !== undefined) {
    if (!Number.isFinite(edit.tempo) || edit.tempo < 10 || edit.tempo > 400) throw new Error('Enter a quarter-note tempo between 10 and 400 BPM.');
    let direction = Array.from(measure.children).find(child => child.localName === 'direction' && child.querySelector('metronome') && !Number(child.querySelector('offset')?.textContent || 0));
    if (!direction) {
      direction = xml.createElement('direction');
      measure.insertBefore(direction, Array.from(measure.children).find(child => child.localName === 'note') || null);
    }
    direction.setAttribute('placement', 'above');
    let metronome = direction.querySelector('metronome');
    if (!metronome) {
      const kind = xml.createElement('direction-type'); metronome = xml.createElement('metronome');
      kind.append(metronome); direction.prepend(kind);
    }
    metronome.replaceChildren();
    for (const [tag, value] of [['beat-unit', 'quarter'], ['per-minute', String(edit.tempo)]]) {
      const child = xml.createElement(tag); child.textContent = value; metronome.append(child);
    }
    let sound = direction.querySelector('sound');
    if (!sound) { sound = xml.createElement('sound'); direction.append(sound); }
    sound.setAttribute('tempo', String(edit.tempo));
  }
  if (edit.note) {
    const change = edit.note;
    const note = Array.from(measure.children).filter(child => child.localName === 'note')[change.index];
    if (!note || !lengths[change.type] || !Number.isInteger(change.dots) || change.dots < 0 || change.dots > 3) throw new Error('Choose a note/rest, length and zero to three dots.');
    if (change.grace && note.querySelector('rest')) throw new Error('A rest cannot be a grace note.');
    if (!change.separate && note.querySelector('rest')) throw new Error('A rest cannot join a chord.');
    if (!change.separate && change.index === 0) throw new Error('The first note in a measure cannot join a previous note.');
    const noteOrder = ['grace', 'cue', 'chord', 'pitch', 'unpitched', 'rest', 'duration', 'tie', 'instrument', 'footnote', 'level', 'voice', 'type', 'dot', 'accidental', 'time-modification', 'stem', 'notehead', 'notehead-text', 'staff', 'beam', 'notations', 'lyric'];
    orderedChild(xml, note, 'type', noteOrder).textContent = change.type;
    note.querySelector('rest')?.removeAttribute('measure');
    note.querySelectorAll('dot').forEach(dot => dot.remove());
    const type = note.querySelector('type')!;
    for (let dot = 0; dot < change.dots; dot++) type.after(xml.createElement('dot'));
    if (change.separate) note.querySelectorAll('chord').forEach(chord => chord.remove());
    else orderedChild(xml, note, 'chord', noteOrder);
    if (change.grace) {
      orderedChild(xml, note, 'grace', noteOrder);
      note.querySelectorAll('duration, cue').forEach(child => child.remove());
    } else {
      note.querySelectorAll('grace').forEach(child => child.remove());
      let divisions = 1;
      for (const preceding of measures.slice(0, measureIndex + 1)) {
        const value = preceding.querySelector('attributes > divisions')?.textContent;
        if (value) divisions = Number(value);
      }
      const [num, den] = lengths[change.type];
      const actual = Number(note.querySelector('time-modification > actual-notes')?.textContent || 1);
      const normal = Number(note.querySelector('time-modification > normal-notes')?.textContent || 1);
      let numerator = divisions * num * (2 ** (change.dots + 1) - 1) * normal;
      let denominator = den * 2 ** change.dots * actual;
      if (![numerator, denominator].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('This note has unsupported timing divisions.');
      const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
      const common = gcd(numerator, denominator); numerator /= common; denominator /= common;
      if (denominator > 1) {
        // Increase precision without changing any other note's timing.
        if (!measures[0].querySelector('attributes > divisions')) {
          const firstAttributes = orderedChild(xml, measures[0], 'attributes', ['print', 'attributes', 'note']);
          orderedChild(xml, firstAttributes, 'divisions', attributeOrder).textContent = '1';
        }
        for (const value of part.querySelectorAll('duration, offset, attributes > divisions')) {
          const scaled = Number(value.textContent) * denominator;
          if (!Number.isSafeInteger(scaled)) throw new Error('The score timing cannot be represented safely.');
          value.textContent = String(scaled);
        }
      }
      orderedChild(xml, note, 'duration', noteOrder).textContent = String(numerator);
    }
  }
  if (edit.addGrace) {
    const change = edit.addGrace;
    const following = Array.from(measure.children).filter(child => child.localName === 'note')[change.before];
    if (!following || !/^[A-G]$/.test(change.step) || !Number.isInteger(change.octave) || change.octave < 0 || change.octave > 9 || ![-1, 0, 1].includes(change.alter) || !['eighth', '16th'].includes(change.type)) throw new Error('Choose a following note and a valid grace-note pitch.');
    const note = xml.createElement('note');
    const grace = xml.createElement('grace'); grace.setAttribute('slash', 'yes'); note.append(grace);
    const pitch = xml.createElement('pitch');
    for (const [tag, value] of [['step', change.step], ['alter', String(change.alter)], ['octave', String(change.octave)]]) {
      const child = xml.createElement(tag); child.textContent = value; pitch.append(child);
    }
    note.append(pitch);
    for (const [tag, value] of [['voice', following.querySelector('voice')?.textContent || '1'], ['type', change.type], ['accidental', change.alter < 0 ? 'flat' : change.alter > 0 ? 'sharp' : 'natural']]) {
      const child = xml.createElement(tag); child.textContent = value; note.append(child);
    }
    measure.insertBefore(note, following);
    const notes = Array.from(measure.children).filter(child => child.localName === 'note');
    const index = notes.indexOf(note);
    let begin = index, end = index;
    const sameRun = (other: Element) => !!other.querySelector('grace') && !other.querySelector('chord') && other.querySelector('type')?.textContent === change.type && (other.querySelector('voice')?.textContent || '1') === (note.querySelector('voice')?.textContent || '1');
    while (begin > 0 && sameRun(notes[begin - 1])) begin--;
    while (end + 1 < notes.length && sameRun(notes[end + 1])) end++;
    if (end > begin) {
      for (let i = begin; i <= end; i++) {
        notes[i].querySelectorAll('beam').forEach(beam => beam.remove());
        for (let level = 1; level <= (change.type === '16th' ? 2 : 1); level++) {
          const beam = xml.createElement('beam'); beam.setAttribute('number', String(level));
          beam.textContent = i === begin ? 'begin' : i === end ? 'end' : 'continue';
          notes[i].insertBefore(beam, notes[i].querySelector('notations, lyric'));
        }
      }
    }
  }
  return new XMLSerializer().serializeToString(xml);
}
