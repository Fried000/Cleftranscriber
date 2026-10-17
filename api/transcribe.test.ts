import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import { createTranscriptionHandler } from './transcribe.ts';

async function listen(server: Server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return `http://127.0.0.1:${address.port}`;
}

async function upload(url: string) {
  const form = new FormData();
  form.append('image', new Blob(['image fixture'], { type: 'image/png' }), 'crop.png');
  form.append('sourceClef', 'treble');
  form.append('targetClef', 'bass');
  return fetch(url, { method: 'POST', body: form });
}

test('production uploads retain the complete MusicXML and recognition warnings', async (t) => {
  const score = { musicXml: '<score-partwise><part><measure><note><pitch><step>B</step><alter>-1</alter><octave>4</octave></pitch><duration>3</duration><type>quarter</type><dot/><beam>begin</beam><notations><tied type="start"/></notations></note></measure></part></score-partwise>',
    noteCount: 1, measureCount: 1, warnings: ['Check measure 1.'], engine: 'Audiveris' };
  const service = createServer(async (request, response) => {
    assert.equal(request.url, '/transcribe');
    assert.equal(request.headers.authorization, 'Bearer test-token');
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();
    assert.match(body, /name="file"/);
    assert.match(body, /name="source_clef"/);
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(score));
  });
  t.after(() => service.close());
  const serviceUrl = await listen(service);
  const api = createServer(createTranscriptionHandler(serviceUrl, 'test-token', false));
  t.after(() => api.close());
  const response = await upload(await listen(api));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), score);
});

test('non-JSON upstream failure identifies service status instead of blaming the crop', async (t) => {
  const service = createServer((_request, response) => {
    response.writeHead(502, { 'Content-Type': 'text/html' });
    response.end('<html>Bad gateway</html>');
  });
  t.after(() => service.close());
  const api = createServer(createTranscriptionHandler(await listen(service), 'test-token', false));
  t.after(() => api.close());
  const response = await upload(await listen(api));
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /HTTP 502.*OMR_SERVICE_URL/);
});
