import { useEffect, useRef, useState } from 'react';
import { Crop, ImageOff, X } from 'lucide-react';

type ImagePreviewProps = {
  file: File;
  onRemove: () => void;
  onCropChange: (file: File | null) => void;
};

type CropSelection = { left: number; top: number; width: number; height: number };

function ImagePreview({ file, onRemove, onCropChange }: ImagePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const selectionStart = useRef<{ x: number; y: number } | null>(null);
  const [previewSize, setPreviewSize] = useState<{ width: number; height: number } | null>(null);
  const [selection, setSelection] = useState<CropSelection | null>(null);
  const [croppedFile, setCroppedFile] = useState<File | null>(null);
  const [croppedUrl, setCroppedUrl] = useState<string | null>(null);
  const [cropError, setCropError] = useState('');

  useEffect(() => {
    setPreviewSize(null);
    setSelection(null);
    setCroppedFile(null);
    setCropError('');
    onCropChange(null);
  }, [file, onCropChange]);

  useEffect(() => {
    let cancelled = false;
    createImageBitmap(file).then((bitmap) => {
      if (cancelled) {
        bitmap.close();
        return;
      }
      const scale = Math.min(1, 1800 / bitmap.width, 1800 / bitmap.height);
      const canvas = canvasRef.current;
      const context = canvas?.getContext('2d');
      if (canvas && context) {
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        setPreviewSize({ width: canvas.width, height: canvas.height });
      }
      bitmap.close();
    }).catch(() => {
      if (!cancelled) setCropError('Could not prepare this image for cropping.');
    });

    return () => { cancelled = true; };
  }, [file]);

  useEffect(() => {
    if (!croppedFile) {
      setCroppedUrl(null);
      return;
    }
    const url = URL.createObjectURL(croppedFile);
    setCroppedUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [croppedFile]);

  const getPoint = (clientX: number, clientY: number) => {
    const bounds = stageRef.current?.getBoundingClientRect();
    if (!bounds) return null;
    return {
      x: Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (clientY - bounds.top) / bounds.height)),
    };
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (croppedFile) return;
    const point = getPoint(event.clientX, event.clientY);
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    selectionStart.current = point;
    setSelection({ left: point.x, top: point.y, width: 0, height: 0 });
    setCropError('');
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = selectionStart.current;
    const point = getPoint(event.clientX, event.clientY);
    if (!start || !point) return;
    setSelection({
      left: Math.min(start.x, point.x),
      top: Math.min(start.y, point.y),
      width: Math.abs(point.x - start.x),
      height: Math.abs(point.y - start.y),
    });
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    handlePointerMove(event);
    selectionStart.current = null;
  };

  const applyCrop = async () => {
    if (!selection || selection.width < 0.02 || selection.height < 0.02) {
      setCropError('Drag to select a staff or system first.');
      return;
    }
    setCropError('');
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      setCropError('Could not open this image for cropping.');
      return;
    }
    try {
      const sx = Math.round(selection.left * bitmap.width);
      const sy = Math.round(selection.top * bitmap.height);
      const sw = Math.max(1, Math.min(bitmap.width - sx, Math.round(selection.width * bitmap.width)));
      const sh = Math.max(1, Math.min(bitmap.height - sy, Math.round(selection.height * bitmap.height)));
      const canvas = document.createElement('canvas');
      canvas.width = sw;
      canvas.height = sh;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Could not crop this image.');
      context.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Could not export the crop.')), 'image/png');
      });
      const nextFile = new File([blob], `${file.name.replace(/\.[^.]+$/, '')}-crop.png`, { type: 'image/png' });
      setCroppedFile(nextFile);
      setSelection(null);
      onCropChange(nextFile);
    } catch (error) {
      setCropError(error instanceof Error ? error.message : 'Could not crop this image.');
    } finally {
      bitmap.close();
    }
  };

  const clearCrop = () => {
    setCroppedFile(null);
    setSelection(null);
    onCropChange(null);
  };

  return (
    <div className="preview-card">
      <div className="preview-card-header">
        <div><p className="eyebrow">SELECTED IMAGE</p><h3>{file.name}</h3></div>
        <button className="icon-button" type="button" onClick={onRemove} aria-label="Remove image" title="Remove image"><X size={19} /></button>
      </div>
      {croppedFile && croppedUrl ? (
        <div className="preview-frame"><img src={croppedUrl} alt={`Selected crop from ${file.name}`} /><div className="preview-watermark"><ImageOff size={14} aria-hidden="true" /> Selected crop</div></div>
      ) : (
        <>
          <p className="crop-instruction">Use the full image, or select complete staff systems including clefs and ledger notes.</p>
          <div
            ref={stageRef}
            className="crop-stage"
            style={{ maxWidth: previewSize ? `${Math.min(840, 520 * previewSize.width / previewSize.height)}px` : undefined }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            role="group"
            aria-label="Drag to select a sheet music region"
          >
            <canvas ref={canvasRef} aria-label={`Crop source image ${file.name}`} role="img" />
            {selection && <div className="crop-selection" style={{ left: `${selection.left * 100}%`, top: `${selection.top * 100}%`, width: `${selection.width * 100}%`, height: `${selection.height * 100}%` }} />}
          </div>
        </>
      )}
      <div className="crop-controls">
        {croppedFile ? (
          <button className="secondary-button" type="button" onClick={clearCrop}><Crop size={16} aria-hidden="true" /> Change Crop</button>
        ) : (
          <button className="secondary-button" type="button" onClick={applyCrop} disabled={!selection || selection.width < 0.02 || selection.height < 0.02}><Crop size={16} aria-hidden="true" /> Crop Selected Area</button>
        )}
        <p className="crop-status" role="status">{cropError || (croppedFile ? 'Selected region will be sent for recognition.' : 'The full image will be used unless you apply a crop.')}</p>
      </div>
      <button className="remove-button" type="button" onClick={onRemove}>Remove Image</button>
    </div>
  );
}

export default ImagePreview;
