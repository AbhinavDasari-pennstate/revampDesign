import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `npm run dev` serves the app on 127.0.0.1:5173 and sends /api to the mock server (`npm run mock`, port 8787).
// `npm run build` writes dist/, which web/ui/dev/mock-server.mjs and web/server/server.mjs both serve.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
  test: {
    include: ['test/**/*.test.{js,jsx}'],
    environment: 'node',
  },
});
