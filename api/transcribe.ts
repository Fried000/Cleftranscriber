import { unlink, readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import formidable from 'formidable';
import { omrEndpoints, omrFailure } from '../server/omr-service.ts';

const CLEFS = ['treble', 'bass', 'alto', 'tenor'] as const;
const ACCEPTED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_FILE_SIZE = 10 * 1024 * 1024;

type Clef = typeof CLEFS[number];

function firstField(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function respondWithError(response: ServerResponse, status: number, message: string) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify({ error: message }));
}

export function createTranscriptionHandler(
  serviceUrl?: string,
  serviceToken?: string,
  _includeDebug = process.env.NODE_ENV !== 'production',
) {
  return async (request: IncomingMessage, response: ServerResponse) => {
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      respondWithError(response, 405, 'Use POST to transcribe sheet music.');
      return;
    }

    if (!serviceUrl || !serviceToken) {
      respondWithError(response, 503, 'Set OMR_SERVICE_URL and OMR_SERVICE_TOKEN on the server to enable local music recognition.');
      return;
    }

    let endpoint: URL;
    try {
      endpoint = omrEndpoints(serviceUrl).transcription;
    } catch (error) {
      respondWithError(response, 503, error instanceof Error ? error.message : 'Invalid OMR service URL.');
      return;
    }

    let temporaryPath: string | undefined;
    try {
      const form = formidable({ maxFiles: 1, maxFileSize: MAX_FILE_SIZE, maxTotalFileSize: MAX_FILE_SIZE });
      const [fields, files] = await form.parse(request);
      const uploadedImage = Array.isArray(files.image) ? files.image[0] : files.image;
      temporaryPath = uploadedImage?.filepath;
      const sourceClef = firstField(fields.sourceClef);
      const targetClef = firstField(fields.targetClef);

      if (!uploadedImage || !sourceClef || !CLEFS.includes(sourceClef as Clef) || !targetClef || !CLEFS.includes(targetClef as Clef)) {
        respondWithError(response, 400, 'Upload an image and select valid source and target clefs.');
        return;
      }
      if (!uploadedImage.mimetype || !ACCEPTED_TYPES.has(uploadedImage.mimetype)) {
        respondWithError(response, 400, 'Use a PNG, JPG, JPEG, or WEBP image.');
        return;
      }

      const imageData = await readFile(uploadedImage.filepath);
      const serviceForm = new FormData();
      serviceForm.append('file', new Blob([imageData], { type: uploadedImage.mimetype }), uploadedImage.originalFilename || 'score.png');
      serviceForm.append('source_clef', sourceClef);
      const serviceResponse = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${serviceToken}` },
        body: serviceForm,
        redirect: 'manual',
        signal: AbortSignal.timeout(285_000),
      });

      const serviceResult = await serviceResponse.json().catch(() => null) as {
        detail?: unknown;
        musicXml?: string;
        noteCount?: number;
        measureCount?: number;
        warnings?: string[];
        engine?: string;
      } | null;
      if (!serviceResponse.ok) {
        const status = [401, 403, 404, 405].includes(serviceResponse.status) || (serviceResponse.status >= 300 && serviceResponse.status < 400) ? 503 : serviceResponse.status;
        const message = omrFailure(endpoint, serviceResponse.status, serviceResult?.detail);
        respondWithError(response, status, message);
        return;
      }

      if (typeof serviceResult?.musicXml !== 'string' || serviceResult.musicXml.length > 8_000_000 ||
          !serviceResult.musicXml.includes('<score-partwise') ||
          !Number.isInteger(serviceResult.noteCount) || serviceResult.noteCount! <= 0 ||
          !Number.isInteger(serviceResult.measureCount) || serviceResult.measureCount! <= 0) {
        respondWithError(response, 502, 'The OMR service did not return complete MusicXML. Rebuild the OMR service to update it.');
        return;
      }
      response.statusCode = 200;
      response.setHeader('Content-Type', 'application/json');
      response.setHeader('Cache-Control', 'no-store');
      response.end(JSON.stringify({
        musicXml: serviceResult.musicXml,
        noteCount: serviceResult.noteCount,
        measureCount: serviceResult.measureCount,
        warnings: Array.isArray(serviceResult.warnings) ? serviceResult.warnings.filter((warning) => typeof warning === 'string') : [],
        engine: typeof serviceResult.engine === 'string' ? serviceResult.engine : 'OMR',
      }));
    } catch (error) {
      const isTimeout = error instanceof Error && error.name === 'TimeoutError';
      console.error('Local OMR service request failed:', error instanceof Error ? error.message : 'Unknown error');
      respondWithError(response, isTimeout ? 504 : 503, isTimeout ? 'OMR took too long. Crop a smaller staff region and try again.' : 'The OMR service is unavailable. Ensure the configured service is running and publicly reachable from Vercel.');
    } finally {
      if (temporaryPath) await unlink(temporaryPath).catch(() => undefined);
    }
  };
}

export const config = { api: { bodyParser: false }, maxDuration: 300 };

export default function handler(request: IncomingMessage, response: ServerResponse) {
  return createTranscriptionHandler(
    process.env.OMR_SERVICE_URL,
    process.env.OMR_SERVICE_TOKEN,
    process.env.NODE_ENV !== 'production',
  )(request, response);
}
