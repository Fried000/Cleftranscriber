import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import { createHealthHandler } from '../api/omr-health.ts';
import { omrEndpoints, omrFailure } from '../server/omr-service.ts';

async function listen(server: Server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return `http://127.0.0.1:${address.port}`;
}

test('base and full endpoint URLs resolve without duplicating /transcribe', () => {
  for (const value of ['https://omr.example.org/music', ' https://omr.example.org/music/transcribe/ ']) {
    const urls = omrEndpoints(value);
    assert.equal(urls.transcription.href, 'https://omr.example.org/music/transcribe');
    assert.equal(urls.health.href, 'https://omr.example.org/music/health');
  }
});

test('invalid or localhost Vercel configuration fails with an actionable message', () => {
  assert.throws(() => omrEndpoints('localhost:8001'), /HTTP or HTTPS/);
  assert.throws(() => omrEndpoints('http://127.0.0.1:8001', true), /Vercel cannot reach/);
  assert.equal(omrEndpoints('http://127.0.0.1:8001', false).transcription.pathname, '/transcribe');
});

test('Codespaces empty 404 and authentication redirects identify port accessibility', () => {
  const endpoint = new URL('https://example-space-8001.app.github.dev/transcribe');
  for (const status of [302, 401, 403, 404, 502]) {
    assert.match(omrFailure(endpoint, status), /set port 8001 to Public/);
  }
  assert.match(omrFailure(endpoint, 401, 'Invalid OMR service token.'), /OMR_SERVICE_TOKEN matches/);
});

test('health endpoint checks the actual service and exposes no token', async (t) => {
  const service = createServer((request, response) => {
    assert.equal(request.url, '/health');
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ status: 'ok', engine: 'Audiveris' }));
  });
  t.after(() => service.close());
  const api = createServer(createHealthHandler(`${await listen(service)}/transcribe`, 'private-test-token'));
  t.after(() => api.close());
  const response = await fetch(await listen(api));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { status: 'ok', engine: 'Audiveris' });
});

test('a login redirect is reported instead of following it and claiming a healthy service', async (t) => {
  let loginRequests = 0;
  const service = createServer((request, response) => {
    if (request.url === '/login') loginRequests++;
    response.writeHead(302, { Location: '/login' });
    response.end();
  });
  t.after(() => service.close());
  const api = createServer(createHealthHandler(await listen(service), 'test-token'));
  t.after(() => api.close());
  const response = await fetch(await listen(api));
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /browser sign-in page/);
  assert.equal(loginRequests, 0);
});

test('a website returning HTML is not mistaken for an OMR service', async (t) => {
  const service = createServer((_request, response) => response.end('<html>Website</html>'));
  t.after(() => service.close());
  const api = createServer(createHealthHandler(await listen(service), 'test-token'));
  t.after(() => api.close());
  const response = await fetch(await listen(api));
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /does not identify an Audiveris/);
});
