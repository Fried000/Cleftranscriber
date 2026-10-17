import type { IncomingMessage, ServerResponse } from 'node:http';
import { omrEndpoints, omrFailure } from '../server/omr-service.ts';

export function createHealthHandler(serviceUrl?: string, serviceToken?: string) {
  return async (request: IncomingMessage, response: ServerResponse) => {
    const send = (status: number, body: object) => {
      response.statusCode = status;
      response.setHeader('Content-Type', 'application/json');
      response.setHeader('Cache-Control', 'no-store');
      response.end(JSON.stringify(body));
    };
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      send(405, { error: 'Use GET to check recognition service availability.' });
      return;
    }
    try {
      if (!serviceToken) throw new Error('Set OMR_SERVICE_TOKEN in the server environment to enable recognition.');
      const endpoint = omrEndpoints(serviceUrl).health;
      const upstream = await fetch(endpoint, { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
      const body = await upstream.json().catch(() => null) as { status?: string; engine?: string; detail?: unknown } | null;
      if (!upstream.ok) throw new Error(omrFailure(endpoint, upstream.status, body?.detail));
      if (body?.status !== 'ok' || body.engine !== 'Audiveris') {
        throw new Error('The URL does not identify an Audiveris OMR service. Check the URL and rebuild the OMR service with the latest code.');
      }
      send(200, { status: 'ok', engine: body.engine });
    } catch (error) {
      const message = error instanceof TypeError || (error instanceof Error && error.name === 'TimeoutError')
        ? 'The OMR service could not be reached. Start the service and verify that OMR_SERVICE_URL is publicly reachable.'
        : error instanceof Error ? error.message : 'The OMR service could not be reached.';
      send(503, { status: 'unavailable', error: message });
    }
  };
}

export default function handler(request: IncomingMessage, response: ServerResponse) {
  return createHealthHandler(process.env.OMR_SERVICE_URL, process.env.OMR_SERVICE_TOKEN)(request, response);
}
