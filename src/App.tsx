import { useCallback, useEffect, useRef, useState } from 'react';
import { FileImage, RotateCcw, Sparkles, Upload } from 'lucide-react';
import Header from './components/Header';
import ImagePreview from './components/ImagePreview';
import ImageUploader from './components/ImageUploader';
import ClefSelector from './components/ClefSelector';
import TranscribeButton from './components/TranscribeButton';
import TranscriptionResult from './components/TranscriptionResult';
import { renderMusicXml, type RecognizedScore } from './musicxml';
import './transcription.css';

const DEFAULT_SOURCE = 'treble';
const DEFAULT_TARGET = 'bass';

export type Clef = 'treble' | 'bass' | 'alto' | 'tenor';

const MAX_API_IMAGE_SIZE = 4 * 1024 * 1024;

async function prepareImageForGeneration(file: File) {
  if (file.size <= MAX_API_IMAGE_SIZE) return file;

  const bitmap = await createImageBitmap(file);
  try {
    let scale = 1;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not prepare this image for upload.');

    for (let attempt = 0; attempt < 8; attempt++) {
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      // Try lossless PNG at source resolution before any lossy compression.
      // Small rest hooks and flags must survive upload preparation.
      const format = attempt === 0 ? 'image/png' : 'image/jpeg';
      const compressed = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not compress this image.')), format, 0.97);
      });
      if (compressed.size <= MAX_API_IMAGE_SIZE) {
        return new File([compressed], format === 'image/png' ? 'sheet-music.png' : 'sheet-music.jpg', { type: format });
      }
      if (attempt > 0) scale *= 0.9;
    }

    throw new Error('This image could not be reduced enough to send. Choose a smaller image.');
  } finally {
    bitmap.close();
  }
}

function App() {
  const [file, setFile] = useState<File | null>(null);
  const [sourceClef, setSourceClef] = useState<Clef>(DEFAULT_SOURCE);
  const [targetClef, setTargetClef] = useState<Clef>(DEFAULT_TARGET);
  const [croppedFile, setCroppedFile] = useState<File | null>(null);
  const [message, setMessage] = useState('');
  const [transcriptionUrl, setTranscriptionUrl] = useState<string | null>(null);
  const [noteCount, setNoteCount] = useState(0);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [octaveShift, setOctaveShift] = useState(0);
  const [recognitionMode, setRecognitionMode] = useState('detailed');
  const [renderedOctaveShift, setRenderedOctaveShift] = useState(0);
  const [recognition, setRecognition] = useState<RecognizedScore | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [renderedClef, setRenderedClef] = useState<Clef>(DEFAULT_TARGET);
  const renderRequestId = useRef(0);

  const handleCropChange = useCallback((nextCrop: File | null) => {
    renderRequestId.current++;
    setCroppedFile(nextCrop);
    setRecognition(null);
    setWarnings([]);
    setTranscriptionUrl(null);
    setIsTranscribing(false);
  }, []);

  useEffect(() => {
    return () => {
      if (transcriptionUrl) URL.revokeObjectURL(transcriptionUrl);
    };
  }, [transcriptionUrl]);

  const handleFileAccepted = (nextFile: File) => {
    renderRequestId.current++;
    setRecognition(null);
    setWarnings([]);
    setIsTranscribing(false);
    setFile(nextFile);
    setCroppedFile(null);
    setTranscriptionUrl(null);
    setMessage('Transcribe the full image, or select a crop with complete staff systems.');
  };

  const handleTranscribe = async () => {
    if (!file) {
      setMessage('Please upload an image first.');
      return;
    }
    const requestId = ++renderRequestId.current;
    setIsTranscribing(true);
    setMessage('Reading the score with Audiveris. This may take a minute...');
    setRecognition(null);
    setWarnings([]);
    setTranscriptionUrl(null);
    try {
      const formData = new FormData();
      formData.append('image', await prepareImageForGeneration(croppedFile || file));
      formData.append('sourceClef', sourceClef);
      formData.append('targetClef', targetClef);
      formData.append('recognitionMode', recognitionMode);
      const response = await fetch('/api/transcribe', { method: 'POST', body: formData });
      if (!response.ok) {
        const result = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(result?.error || 'Music recognition failed. Please try again.');
      }

      const score = await response.json() as RecognizedScore;
      if (requestId !== renderRequestId.current) return;
      setRecognition(score);
      setWarnings(score.warnings || []);
    } catch (error) {
      if (requestId !== renderRequestId.current) return;
      setMessage(error instanceof Error ? error.message : 'Transcription failed. Please try another image.');
    } finally {
      if (requestId === renderRequestId.current) setIsTranscribing(false);
    }
  };

  useEffect(() => {
    if (!recognition) return;
    let cancelled = false;
    const requestId = ++renderRequestId.current;
    setIsTranscribing(true);
    setTranscriptionUrl(null);
    setMessage('Engraving the complete MusicXML score...');
    void (async () => {
      try {
        const image = await renderMusicXml(recognition.musicXml, targetClef, octaveShift);
        if (cancelled || requestId !== renderRequestId.current) return;
        setTranscriptionUrl(URL.createObjectURL(image));
        setRenderedClef(targetClef);
        setRenderedOctaveShift(octaveShift);
        setNoteCount(recognition.noteCount);
        setMessage(`Read ${recognition.noteCount} notes in ${recognition.measureCount} measures.${recognition.warnings.length ? ' Some measures need review below.' : ' Compare with your source before using the score.'}`);
      } catch (error) {
        if (!cancelled && requestId === renderRequestId.current) setMessage(error instanceof Error ? error.message : 'Could not engrave the score.');
      } finally {
        if (!cancelled && requestId === renderRequestId.current) setIsTranscribing(false);
      }
    })();
    return () => { cancelled = true; };
  }, [recognition, targetClef, octaveShift]);

  const removeImage = () => {
    renderRequestId.current++;
    setRecognition(null);
    setWarnings([]);
    setIsTranscribing(false);
    setFile(null);
    setCroppedFile(null);
    setTranscriptionUrl(null);
    setMessage('');
  };

  const resetAll = () => {
    renderRequestId.current++;
    setRecognition(null);
    setWarnings([]);
    setIsTranscribing(false);
    setFile(null);
    setCroppedFile(null);
    setSourceClef(DEFAULT_SOURCE);
    setTargetClef(DEFAULT_TARGET);
    setOctaveShift(0);
    setRecognitionMode('detailed');
    setTranscriptionUrl(null);
    setMessage('');
  };

  return (
    <div className="app-shell">
      <Header />
      <main className="container">
        <section className="intro" aria-labelledby="page-title">
          <div className="intro-mark"><Sparkles size={18} aria-hidden="true" /></div>
          <p className="eyebrow">SHEET MUSIC TOOL</p>
          <h1 id="page-title">Clef Transcriber</h1>
          <p className="subtitle">Convert your sheet music to the clef you need.</p>
        </section>

        <section className="workspace" aria-label="Transcription workspace">
          <div className="section-heading">
            <div>
              <p className="eyebrow">01 / INPUT</p>
              <h2>Upload your sheet music</h2>
            </div>
            {file && <button className="reset-button" type="button" onClick={resetAll}><RotateCcw size={15} aria-hidden="true" /> Start Over</button>}
          </div>

          {file ? (
            <ImagePreview file={file} onRemove={removeImage} onCropChange={handleCropChange} />
          ) : (
            <ImageUploader onFileAccepted={handleFileAccepted} onError={setMessage} />
          )}

          <div className="settings-heading">
            <div>
              <p className="eyebrow">02 / SETTINGS</p>
              <h2>Choose your clefs</h2>
            </div>
            <FileImage className="heading-icon" size={24} aria-hidden="true" />
          </div>
          <div className="selectors">
            <ClefSelector id="source-clef" label="Source Clef" value={sourceClef} onChange={setSourceClef} />
            <ClefSelector id="target-clef" label="Target Clef" value={targetClef} onChange={setTargetClef} />
          </div>

          <div className="octave-controls" role="group" aria-label="Octave transposition">
            <span>Octave</span>
            <button type="button" onClick={() => setOctaveShift((value) => value - 2)} disabled={octaveShift < -1} aria-label="Transpose down two octaves">−2 octaves</button>
            <button type="button" onClick={() => setOctaveShift((value) => Math.max(-3, value - 1))} disabled={octaveShift <= -3} aria-label="Transpose down one octave">−1 octave</button>
            <output aria-live="polite">{octaveShift === 0 ? 'Original' : `${octaveShift > 0 ? '+' : ''}${octaveShift} octave${Math.abs(octaveShift) === 1 ? '' : 's'}`}</output>
            <button type="button" onClick={() => setOctaveShift((value) => Math.min(3, value + 1))} disabled={octaveShift >= 3} aria-label="Transpose up one octave">+1 octave</button>
            <button type="button" onClick={() => setOctaveShift((value) => value + 2)} disabled={octaveShift > 1} aria-label="Transpose up two octaves">+2 octaves</button>
          </div>
          <p className="octave-hint">Lower or raise all notes together to fit your reading range. Notes beyond the staff use ledger lines.</p>

          <div className="recognition-settings">
            <label htmlFor="recognition-mode">Score recognition</label>
            <select id="recognition-mode" value={recognitionMode} disabled={isTranscribing} onChange={(event) => {
              setRecognitionMode(event.target.value);
              setMessage('Recognition mode changed. Press Transcribe to read the image again.');
            }}>
              <option value="detailed">Detailed — include small grace and cue notes</option>
              <option value="standard">Standard — fewer small-symbol detections</option>
            </select>
            <p>Detailed mode reads small grace and cue noteheads. Accents, staccato, rests and supported tuplets are read in both modes. Compare with the original: small marks can still be missed or misread. If ordinary notes look wrong, try Standard and transcribe again.</p>
          </div>

          <div className="action-area">
            <TranscribeButton onClick={handleTranscribe} isLoading={isTranscribing} disabled={!file} />
            <p className="status-message" role="status" aria-live="polite">{message}</p>
          </div>
          {warnings.length > 0 && <div className="recognition-warnings" role="status"><strong>Recognition needs review</strong>{warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>}
          {transcriptionUrl && <TranscriptionResult imageUrl={transcriptionUrl} targetClef={renderedClef} noteCount={noteCount} octaveShift={renderedOctaveShift} musicXml={recognition?.musicXml} />}
        </section>
        <p className="privacy-note"><Upload size={14} aria-hidden="true" /> Your image is processed by your configured Audiveris service.</p>
      </main>
      <footer>Clef Transcriber <span>Audiveris OMR · MusicXML engraving</span></footer>
    </div>
  );
}

export default App;
