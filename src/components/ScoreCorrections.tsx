import { useEffect, useMemo, useState } from 'react';
import { correctMeasure, type MeasureEdit } from '../score-corrections';

export default function ScoreCorrections({ musicXml, disabled, onApply }: { musicXml: string; disabled: boolean; onApply: (xml: string) => void }) {
  const xml = useMemo(() => new DOMParser().parseFromString(musicXml, 'application/xml'), [musicXml]);
  const parts = Array.from(xml.querySelectorAll('score-partwise > part'));
  const [partIndex, setPartIndex] = useState(0);
  const [measureIndex, setMeasureIndex] = useState(0);
  const [noteIndex, setNoteIndex] = useState(0);
  const measures = Array.from((parts[partIndex] || parts[0])?.children || []).filter(child => child.localName === 'measure');
  const notes = Array.from(measures[measureIndex]?.children || []).filter(child => child.localName === 'note');
  const [key, setKey] = useState('');
  const [beats, setBeats] = useState('');
  const [beatType, setBeatType] = useState('4');
  const [tempo, setTempo] = useState('');
  const [type, setType] = useState('eighth');
  const [dots, setDots] = useState('0');
  const [grace, setGrace] = useState(false);
  const [separate, setSeparate] = useState(true);
  const [error, setError] = useState('');
  const [newStep, setNewStep] = useState('C');
  const [newOctave, setNewOctave] = useState('5');
  const [newAlter, setNewAlter] = useState('0');
  const [newType, setNewType] = useState<'eighth' | '16th'>('16th');
  useEffect(() => {
    const note = notes[noteIndex];
    setType(note?.querySelector('type')?.textContent || 'eighth');
    setDots(String(note?.querySelectorAll('dot').length || 0));
    setGrace(!!note?.querySelector('grace'));
    setSeparate(!note?.querySelector('chord'));
    setError('');
  // Read fresh note settings whenever a correction produces new XML.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [musicXml, partIndex, measureIndex, noteIndex]);
  useEffect(() => { setKey(''); setBeats(''); setTempo(''); }, [partIndex, measureIndex]);
  const apply = (edit: MeasureEdit) => {
    try {
      const result = correctMeasure(musicXml, parts[partIndex].getAttribute('id')!, measureIndex, edit);
      setError(''); onApply(result); return true;
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not apply correction.'); return false; }
  };
  return <details className="score-corrections">
    <summary>Correct a misread measure</summary>
    <p>Use the measure numbers in the output. Edits keep the current clef and octave setting and do not run recognition again.</p>
    <fieldset disabled={disabled}>
      <div className="correction-fields">
        {parts.length > 1 && <label>Part<select value={partIndex} onChange={event => { setPartIndex(Number(event.target.value)); setMeasureIndex(0); setNoteIndex(0); }}>{parts.map((part, index) => <option key={index} value={index}>{part.getAttribute('id')}</option>)}</select></label>}
        <label>Measure<select aria-label="Measure" value={measureIndex} onChange={event => { setMeasureIndex(Number(event.target.value)); setNoteIndex(0); }}>{measures.map((measure, index) => <option key={index} value={index}>{measure.getAttribute('number') || index + 1}</option>)}</select></label>
      </div>
      <h4>Key, time or tempo at the start of this measure</h4>
      <div className="correction-fields">
        <label>Key signature<select aria-label="Key signature" value={key} onChange={event => setKey(event.target.value)}><option value="">Keep recognized key</option>{Array.from({ length: 15 }, (_, index) => index - 7).map(value => <option key={value} value={value}>{value < 0 ? `${-value} flats` : value > 0 ? `${value} sharps` : 'No sharps or flats'}</option>)}</select></label>
        <label>Beats<input aria-label="Beats" value={beats} placeholder="Keep / e.g. 3+2" onChange={event => setBeats(event.target.value)} /></label>
        <label>Beat value<select aria-label="Beat value" value={beatType} onChange={event => setBeatType(event.target.value)}>{[1, 2, 4, 8, 16, 32, 64].map(value => <option key={value}>{value}</option>)}</select></label>
        <label>Quarter-note BPM<input aria-label="Quarter-note BPM" type="number" min="10" max="400" value={tempo} placeholder="Keep" onChange={event => setTempo(event.target.value)} /></label>
      </div>
      <button type="button" className="secondary-button" disabled={!key && !beats && !tempo} onClick={() => apply({ ...(key !== '' ? { fifths: Number(key) } : {}), ...(beats ? { beats, beatType: Number(beatType) } : {}), ...(tempo ? { tempo: Number(tempo) } : {}) })}>Apply signature / tempo changes</button>
      <p>Key edits change the printed signature and keep the recognized pitches. Check the notes and accidentals against your original.</p>
      <h4>Note or rest</h4>
      <p>Note labels use the recognized pitches before the output octave shift. For stacked grace notes, select each note, enable Grace note and Separate from previous note, then apply.</p>
      <div className="correction-fields">
        <label>Recognized note<select aria-label="Recognized note" value={noteIndex} onChange={event => setNoteIndex(Number(event.target.value))}>{notes.map((note, index) => <option key={index} value={index}>{index + 1}: {note.querySelector('rest') ? 'Rest' : `${note.querySelector('pitch > step')?.textContent || '?'}${note.querySelector('pitch > octave')?.textContent || ''}`}{note.querySelector('grace') ? ' (grace)' : ''}{note.querySelector('chord') ? ' (chord)' : ''}</option>)}</select></label>
        <label>Length<select value={type} onChange={event => setType(event.target.value)}>{['whole', 'half', 'quarter', 'eighth', '16th', '32nd', '64th'].map(value => <option key={value}>{value}</option>)}</select></label>
        <label>Augmentation dots<select value={dots} onChange={event => setDots(event.target.value)}>{[0, 1, 2, 3].map(value => <option key={value}>{value}</option>)}</select></label>
      </div>
      <div className="correction-fields">
        <label className="correction-checkbox"><input type="checkbox" checked={grace} onChange={event => setGrace(event.target.checked)} /> Grace note</label>
        <label className="correction-checkbox"><input type="checkbox" checked={separate} onChange={event => setSeparate(event.target.checked)} /> Separate from previous note</label>
      </div>
      <button type="button" className="secondary-button" disabled={!notes.length} onClick={() => apply({ note: { index: noteIndex, type, dots: Number(dots), grace, separate } })}>Apply note changes</button>
      <h4>Add a grace note the scanner missed</h4>
      <p>Select the following note above. New grace notes are added in order before it, using pitches before the output octave shift.</p>
      <div className="correction-fields">
        <label>Pitch<select aria-label="New grace pitch" value={newStep} onChange={event => setNewStep(event.target.value)}>{['C', 'D', 'E', 'F', 'G', 'A', 'B'].map(step => <option key={step}>{step}</option>)}</select></label>
        <label>Accidental<select aria-label="New grace accidental" value={newAlter} onChange={event => setNewAlter(event.target.value)}><option value="-1">Flat</option><option value="0">Natural</option><option value="1">Sharp</option></select></label>
        <label>Octave<input aria-label="New grace octave" type="number" min="0" max="9" value={newOctave} onChange={event => setNewOctave(event.target.value)} /></label>
        <label>Grace length<select value={newType} onChange={event => setNewType(event.target.value as 'eighth' | '16th')}><option value="eighth">Eighth</option><option value="16th">16th</option></select></label>
      </div>
      <button type="button" className="secondary-button" disabled={!notes.length} onClick={() => {
        if (apply({ addGrace: { before: noteIndex, step: newStep, octave: Number(newOctave), alter: Number(newAlter), type: newType } })) setNoteIndex(value => value + 1);
      }}>Add grace note</button>
      {error && <p role="alert">{error}</p>}
    </fieldset>
  </details>;
}
