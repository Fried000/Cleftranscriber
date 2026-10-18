import { Download } from 'lucide-react';
import { useEffect, useState } from 'react';
import { changeClef } from '../musicxml';
import type { Clef } from '../App';

type TranscriptionResultProps = {
  imageUrl: string;
  targetClef: string;
  noteCount: number;
  octaveShift: number;
  musicXml?: string;
};

function TranscriptionResult({ imageUrl, targetClef, noteCount, octaveShift, musicXml }: TranscriptionResultProps) {
  const [xmlUrl, setXmlUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!musicXml) { setXmlUrl(null); return; }
    const url = URL.createObjectURL(new Blob([changeClef(musicXml, targetClef as Clef, octaveShift)], { type: 'application/vnd.recordare.musicxml+xml' }));
    setXmlUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [musicXml, targetClef, octaveShift]);
  return (
    <section className="transcription-result" aria-labelledby="result-title">
      <div className="result-heading">
        <div>
          <p className="eyebrow">03 / OUTPUT</p>
          <h2 id="result-title">Transcribed sheet</h2>
        </div>
        <a className="download-button" href={imageUrl} download="transcribed-sheet.png" aria-label="Download transcribed sheet image" title="Download PNG">
          <Download size={17} aria-hidden="true" />
          <span>Download PNG</span>
        </a>
      </div>
      {xmlUrl && <p><a href={xmlUrl} download="transcribed-score.musicxml">Download editable MusicXML</a></p>}
      <div className="result-image-frame">
        <img src={imageUrl} alt={`Transcribed sheet music with the requested ${targetClef} clef`} />
      </div>
      <p className="result-caption">{noteCount} recognized notes · {targetClef} clef · {octaveShift === 0 ? 'original octave' : `${octaveShift > 0 ? '+' : ''}${octaveShift} octave(s)`} · compare with the source</p>
    </section>
  );
}

export default TranscriptionResult;
