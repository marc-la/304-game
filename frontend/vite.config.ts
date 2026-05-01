import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

/**
 * Multi-page Vite setup with the repo root as the project root.
 *
 * - Build entries are the static pages at the repo root: index, rules,
 *   stats. ``play.html`` (the React multiplayer app) is intentionally
 *   excluded from the production build — the game isn't ready for
 *   public exposure. It is still served by ``npm run dev`` locally
 *   because the Vite dev server serves any HTML at the project root,
 *   independent of the build's input list.
 * - To temporarily include /play in a build (e.g. for a private
 *   deployment), set ``INCLUDE_PLAY=1`` in the environment.
 * - Output goes to ``frontend/dist/`` (relative to the repo root).
 * - Dev server (``npm run dev``) serves all pages at
 *   ``localhost:5173/`` with HMR for the React parts. ``/api`` is
 *   proxied to the FastAPI backend on port 8000.
 * - Production: ``npm run build`` writes static files to
 *   ``frontend/dist/``; the FastAPI server mounts that directory at
 *   ``/`` (see ``backend/main.py``).
 */

const repoRoot = resolve(__dirname, '..');
const includePlay = process.env.INCLUDE_PLAY === '1';

const buildInputs: Record<string, string> = {
  index: resolve(repoRoot, 'index.html'),
  rules: resolve(repoRoot, 'rules.html'),
  stats: resolve(repoRoot, 'stats.html'),
};
if (includePlay) {
  buildInputs.play = resolve(repoRoot, 'play.html');
}

export default defineConfig({
  plugins: [react()],
  root: repoRoot,
  publicDir: false,           // no auxiliary public dir; everything is in repoRoot
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: buildInputs,
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
