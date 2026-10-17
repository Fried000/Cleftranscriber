import { Download } from 'lucide-react';
import { useEffect, useState } from 'react';
import { changeClef } from '../musicxml';
import type { Clef } from '../App';

type TranscriptionResultProps = {
  imageUrl: string;
  targetClef: string;
  noteCount: number;
  isSample: boolean;
  musicXml?: string;
};

function TranscriptionResult({ imageUrl, targetClef, noteCount, isSample, musicXml }: TranscriptionResultProps) {
  const [xmlUrl, setXmlUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!musicXml || isSample) { setXmlUrl(null); return; }
    const url = URL.createObjectURL(new Blob([changeClef(musicXml, targetClef as Clef)], { type: 'application/vnd.recordare.musicxml+xml' }));
    setXmlUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [musicXml, targetClef, isSample]);
  return (
    <section className="transcription-result" aria-labelledby="result-title">
      <div className="result-heading">
        <div>
          <p className="eyebrow">03 / OUTPUT</p>
          <h2 id="result-title">{isSample ? 'Sample score' : 'Transcribed sheet'}</h2>
        </div>
        <a className="download-button" href={imageUrl} download={isSample ? 'sample-score.png' : 'transcribed-sheet.png'} aria-label="Download transcribed sheet image" title="Download PNG">
          <Download size={17} aria-hidden="true" />
          <span>Download PNG</span>
        </a>
      </div>
      {xmlUrl && <p><a href={xmlUrl} download="transcribed-score.musicxml">Download editable MusicXML</a></p>}
      {isSample && <p className="sample-score-label">Sample score — automatic recognition not used.</p>}
      <div className="result-image-frame">
        <img src={imageUrl} alt={`${isSample ? 'Sample sheet music' : 'Transcribed sheet music'} with the requested ${targetClef} clef`} />
      </div>
      <p className="result-caption">{isSample ? `${noteCount} notes · ${targetClef} clef` : `${noteCount} recognized notes · ${targetClef} clef · recognized pitches and notation retained; compare with the source`}</p>
    </section>
  );
}

export default TranscriptionResult;
