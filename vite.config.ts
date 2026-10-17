import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { createTranscriptionHandler } from './api/transcribe.ts';
import { createHealthHandler } from './api/omr-health.ts';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [
      react(),
      {
        name: 'local-transcription-api',
        configureServer(server) {
          const handler = createTranscriptionHandler(
            env.OMR_SERVICE_URL || 'http://127.0.0.1:8001',
            env.OMR_SERVICE_TOKEN || 'local-omr-secret',
            mode !== 'production',
          );
          server.middlewares.use('/api/transcribe', (request, response) => {
            void handler(request, response);
          });
          const health = createHealthHandler(env.OMR_SERVICE_URL || 'http://127.0.0.1:8001', env.OMR_SERVICE_TOKEN || 'local-omr-secret');
          server.middlewares.use('/api/omr-health', (request, response) => { void health(request, response); });
        },
      },
    ],
  };
});
