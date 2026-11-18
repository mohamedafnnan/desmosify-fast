import { defineConfig } from 'vite';

export default defineConfig({
  define: { __BUILD__: JSON.stringify((process.env.GITHUB_SHA ?? 'dev').slice(0, 7)) },
  base: './',
  worker: { format: 'es' },
  build: { target: 'es2022' },
});
