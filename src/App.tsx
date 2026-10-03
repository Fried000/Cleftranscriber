import { useEffect, useRef, useState } from 'react';
import { FileImage, RotateCcw, Sparkles, Upload } from 'lucide-react';
import Header from './components/Header';
import ImagePreview from './components/ImagePreview';
import ImageUploader from './components/ImageUploader';
import ClefSelector from './components/ClefSelector';
import TranscribeButton from './components/TranscribeButton';
import TranscriptionResult from './components/TranscriptionResult';
import type { ScoreTranscription } from './transcription';
import './transcription.css';

const DEFAULT_SOURCE = 'treble';
const DEFAULT_TARGET = 'bass';

export type Clef = 'treble' | 'bass' | 'alto' | 'tenor';

const MAX_API_IMAGE_SIZE = 4 * 1024 * 1024;

async function prepareImageForGeneration(file: File) {
  if (file.size <= MAX_API_IMAGE_SIZE) return file;

  const bitmap = await createImageBitmap(file);
  try {
    let scale = Math.min(1, 2800 / bitmap.width, 2800 / bitmap.height);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not prepare this image for upload.');

    for (let attempt = 0; attempt < 6; attempt++) {
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const quality = Math.max(0.67, 0.92 - attempt * 0.05);
      const compressed = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not compress this image.')), 'image/jpeg', quality);
      });
      if (compressed.size <= MAX_API_IMAGE_SIZE) {
        return new File([compressed], 'sheet-music.jpg', { type: 'image/jpeg' });
      }
      scale *= 0.8;
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
  const [sampleMode, setSampleMode] = useState(false);
  const [sampleFirstNote, setSampleFirstNote] = useState('C4');
  const [isSampleResult, setIsSampleResult] = useState(false);
  const renderRequestId = useRef(0);

  useEffect(() => {
    return () => {
      if (transcriptionUrl) URL.revokeObjectURL(transcriptionUrl);
    };
  }, [transcriptionUrl]);

  const handleFileAccepted = (nextFile: File) => {
    renderRequestId.current++;
    setSampleMode(false);
    setFile(nextFile);
    setCroppedFile(null);
    setTranscriptionUrl(null);
    setIsSampleResult(false);
    setMessage('Select one staff or system crop before transcribing.');
  };

  const handleTranscribe = async () => {
    if (!file) {
      setMessage('Please upload an image first.');
      return;
    }
    if (!croppedFile) {
      setMessage('Crop one staff or system from the image first.');
      return;
    }

    const requestId = ++renderRequestId.current;
    setSampleMode(false);
    setIsTranscribing(true);
    setMessage('Reading notes and rhythms with Oemer...');
    setTranscriptionUrl(null);
    setIsSampleResult(false);
    try {
      const formData = new FormData();
      formData.append('image', await prepareImageForGeneration(croppedFile));
      formData.append('sourceClef', sourceClef);
      formData.append('targetClef', targetClef);
      const response = await fetch('/api/transcribe', { method: 'POST', body: formData });
      if (!response.ok) {
        const result = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(result?.error || 'Music recognition failed. Please try again.');
      }

      const score = await response.json() as ScoreTranscription;
      const { renderTranscription } = await import('./transcription');
      const image = await renderTranscription(score, targetClef);
      if (requestId !== renderRequestId.current) return;
      const detectedNotes = score.measures.reduce((sum, measure) =>
        sum + measure.notes.reduce((measureSum, note) => measureSum + (note.rest ? 0 : note.pitches.length), 0), 0);
      setTranscriptionUrl(URL.createObjectURL(image));
      setNoteCount(detectedNotes);
      setMessage(`Recognized ${detectedNotes} notes. Check the result against your original.`);
    } catch (error) {
      if (requestId !== renderRequestId.current) return;
      setMessage(error instanceof Error ? error.message : 'Transcription failed. Please try another image.');
    } finally {
      if (requestId === renderRequestId.current) setIsTranscribing(false);
    }
  };

  useEffect(() => {
    if (!sampleMode) return;

    let cancelled = false;
    const requestId = ++renderRequestId.current;
    setTranscriptionUrl(null);
    setIsSampleResult(false);
    setNoteCount(0);
    setMessage('Rendering sample score...');

    const renderSample = async () => {
      try {
        const score: ScoreTranscription = {
          timeSignature: '4/4',
          measures: [{
            notes: [sampleFirstNote, 'D4', 'E4', 'G4'].map((pitch) => ({
              pitches: [pitch],
              duration: 'quarter',
              rest: false,
            })),
          }],
        };
        const { renderTranscription } = await import('./transcription');
        const image = await renderTranscription(score, targetClef);
        if (cancelled || requestId !== renderRequestId.current) return;
        setTranscriptionUrl(URL.createObjectURL(image));
        setNoteCount(score.measures[0].notes.length);
        setIsSampleResult(true);
        setMessage('Sample score rendered.');
      } catch (error) {
        if (cancelled || requestId !== renderRequestId.current) return;
        setMessage(error instanceof Error ? error.message : 'Could not render the sample score.');
      }
    };

    void renderSample();
    return () => {
      cancelled = true;
    };
  }, [sampleFirstNote, sampleMode, targetClef]);

  const handleTrySample = () => {
    if (sampleMode) return;
    renderRequestId.current++;
    setIsTranscribing(false);
    setTranscriptionUrl(null);
    setIsSampleResult(false);
    setSampleMode(true);
  };

  const removeImage = () => {
    renderRequestId.current++;
    setSampleMode(false);
    setFile(null);
    setCroppedFile(null);
    setTranscriptionUrl(null);
    setIsSampleResult(false);
    setMessage('');
  };

  const resetAll = () => {
    renderRequestId.current++;
    setSampleMode(false);
    setFile(null);
    setCroppedFile(null);
    setSourceClef(DEFAULT_SOURCE);
    setTargetClef(DEFAULT_TARGET);
    setTranscriptionUrl(null);
    setIsSampleResult(false);
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
            <ImagePreview file={file} onRemove={removeImage} onCropChange={setCroppedFile} />
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

          <div className="action-area">
            <TranscribeButton onClick={handleTranscribe} isLoading={isTranscribing} disabled={!file || !croppedFile} />
            <div className="sample-score-controls">
              <label className="select-field" htmlFor="sample-first-note">
                <span>First sample note</span>
                <select id="sample-first-note" value={sampleFirstNote} onChange={(event) => setSampleFirstNote(event.target.value)}>
                  {['C4', 'D4', 'E4', 'F4', 'G4'].map((pitch) => <option key={pitch} value={pitch}>{pitch}</option>)}
                </select>
              </label>
              <button className="sample-score-button" type="button" onClick={handleTrySample}>Try sample score</button>
            </div>
            <p className="status-message" role="status" aria-live="polite">{message}</p>
          </div>
          {transcriptionUrl && <TranscriptionResult imageUrl={transcriptionUrl} targetClef={targetClef} noteCount={noteCount} isSample={isSampleResult} />}
        </section>
        <p className="privacy-note"><Upload size={14} aria-hidden="true" /> Your cropped image is sent to your configured Oemer service.</p>
      </main>
      <footer>Clef Transcriber <span>Oemer OMR · VexFlow engraving</span></footer>
    </div>
  );
}

export default App;