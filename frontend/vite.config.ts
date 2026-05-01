import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

/**
 * Multi-page Vite setup with the repo root as the project root.
 *
 * - The four HTML pages at the repo root (index/play/rules/stats) are
 *   the build entries. play.html mounts the React app via the
 *   ``/frontend/src/main.tsx`` script tag; the others are static.
 * - Output goes to ``frontend/dist/`` (relative to the repo root).
 * - Dev server (``npm run dev``) serves all four pages at
 *   ``localhost:5173/`` with HMR for the React parts. ``/api`` is
 *   proxied to the FastAPI backend on port 8000.
 * - Production: ``npm run build`` writes static files to
 *   ``frontend/dist/``; the FastAPI server mounts that directory at
 *   ``/`` (see ``backend/main.py``).
 */

const repoRoot = resolve(__dirname, '..');

export default defineConfig({
  plugins: [react()],
  root: repoRoot,
  publicDir: false,           // no auxiliary public dir; everything is in repoRoot
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(repoRoot, 'index.html'),
        play: resolve(repoRoot, 'play.html'),
        rules: resolve(repoRoot, 'rules.html'),
        stats: resolve(repoRoot, 'stats.html'),
      },
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
});
