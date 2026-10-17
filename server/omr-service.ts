export function omrEndpoints(value: string | undefined, deployedOnVercel = process.env.VERCEL === '1') {
  if (!value?.trim()) throw new Error('Set OMR_SERVICE_URL to the running OMR service URL in the server environment.');
  let transcription: URL;
  try {
    transcription = new URL(value.trim());
  } catch {
    throw new Error('OMR_SERVICE_URL must be a complete http:// or https:// URL.');
  }
  if (!['http:', 'https:'].includes(transcription.protocol) || transcription.username || transcription.password) {
    throw new Error('OMR_SERVICE_URL must be an HTTP or HTTPS service URL without embedded credentials.');
  }
  if (deployedOnVercel && ['localhost', '127.0.0.1', '0.0.0.0', '[::1]'].includes(transcription.hostname)) {
    throw new Error('Vercel cannot reach the OMR service on your computer through localhost. Set OMR_SERVICE_URL to a publicly reachable service URL.');
  }
  const path = transcription.pathname.replace(/\/+$/, '');
  transcription.pathname = path.endsWith('/transcribe') ? path : `${path}/transcribe`;
  transcription.hash = '';
  const health = new URL(transcription);
  health.pathname = transcription.pathname.replace(/\/transcribe$/, '/health');
  return { transcription, health };
}

export function omrFailure(endpoint: URL, status: number, detail?: unknown): string {
  const codespaces = endpoint.hostname.endsWith('.app.github.dev');
  const redirect = status >= 300 && status < 400;
  if (codespaces && (redirect || ([401, 403, 404, 502, 503].includes(status) && typeof detail !== 'string'))) {
    const port = endpoint.hostname.match(/-(\d+)\.app\.github\.dev$/)?.[1] || '8001';
    return `The GitHub Codespaces OMR port is not publicly reachable. Start the Codespace and OMR service, then set port ${port} to Public in Codespaces → Ports → Port Visibility. Keep OMR_SERVICE_TOKEN enabled.`;
  }
  if (status === 401 || status === 403) return 'The OMR service rejected the server token. Check that OMR_SERVICE_TOKEN matches in Vercel and the OMR service.';
  if (status === 404 || status === 405) return 'The configured OMR URL has no recognition endpoint. Set OMR_SERVICE_URL to the OMR service base URL or its full /transcribe URL, then redeploy Vercel.';
  if (redirect) return 'The OMR service redirected to another page. Set OMR_SERVICE_URL to its direct public HTTPS URL; a browser sign-in page cannot process recognition requests.';
  return typeof detail === 'string' ? detail : `The OMR service returned HTTP ${status} without a recognition result. Check OMR_SERVICE_URL and the service logs.`;
}
