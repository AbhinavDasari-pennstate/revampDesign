import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  output: 'static',
  build: { format: 'file', assetsPrefix: '.' },
  vite: { plugins: [tailwindcss()] },
});
