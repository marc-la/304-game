import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { cpSync, existsSync, readFileSync } from 'node:fs';
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

// Copy non-Vite-managed assets that the multi-page site references via
// repo-root-relative URLs. When deploying via GitHub Actions we ship
// only ``dist/``, so any file the HTML references must end up there.
//
// This list is intentionally explicit (rather than copying whole dirs)
// so a stray file dropped into ``css/`` or ``docs/`` doesn't silently
// ship to the live site.
const ASSETS_TO_COPY = [
  // Site stylesheet — loaded by every HTML page.
  'css/styles.css',
  // Classic (non-module) scripts loaded by individual pages.
  // theme.js is loaded by all pages; the others are page-specific.
  'js/theme.js',
  'js/hero-reveal.js', // index.html
  'js/rules.js',       // rules.html (sidebar scroll-spy + collapsibles)
  'js/stats.js',       // stats.html (loads docs/stats.xlsx + bets CSVs)
  // Data fetched at runtime by stats.js.
  'docs/stats.xlsx',
  'docs/bets',
];

const copyRepoAssets = (): Plugin => ({
  name: '304-copy-repo-assets',
  apply: 'build',
  closeBundle() {
    const outDir = resolve(__dirname, 'dist');
    for (const rel of ASSETS_TO_COPY) {
      const src = resolve(repoRoot, rel);
      if (!existsSync(src)) continue;
      cpSync(src, resolve(outDir, rel), { recursive: true });
    }
  },
});

// HTML partial includes. Replaces `<!-- @include partials/foo.html -->` in
// every served/built HTML page with the contents of `partials/foo.html`,
// resolved from the repo root. Runs in both dev and build via
// `transformIndexHtml`, so the header (and other shared chrome) is baked
// into the HTML the browser receives — no runtime injection, no flicker.
const htmlPartials = (): Plugin => ({
  name: '304-html-partials',
  enforce: 'pre',
  transformIndexHtml: {
    order: 'pre',
    handler(html) {
      return html.replace(
        /<!--\s*@include\s+([\w./-]+)\s*-->/g,
        (_match, rel: string) => {
          const partialPath = resolve(repoRoot, rel);
          if (!existsSync(partialPath)) {
            throw new Error(`htmlPartials: missing partial ${rel}`);
          }
          return readFileSync(partialPath, 'utf8').trimEnd();
        },
      );
    },
  },
});

const buildInputs: Record<string, string> = {
  index: resolve(repoRoot, 'index.html'),
  rules: resolve(repoRoot, 'rules.html'),
  cheatsheet: resolve(repoRoot, 'cheatsheet.html'),
  capsFormalism: resolve(repoRoot, 'caps-formalism.html'),
  stats: resolve(repoRoot, 'stats.html'),
  practice: resolve(repoRoot, 'practice.html'),
};
if (includePlay) {
  buildInputs.play = resolve(repoRoot, 'play.html');
}

export default defineConfig({
  plugins: [htmlPartials(), react(), copyRepoAssets()],
  root: repoRoot,
  // Relative asset paths so the build can be served from any subpath
  // (e.g. ``user.github.io/304-game/``) without rewriting hrefs.
  base: './',
  // Static assets that aren't referenced by HTML directly (e.g. the
  // pre-baked daily puzzles loaded by 304dle at runtime). Files here
  // are copied verbatim into ``dist/``.
  publicDir: resolve(__dirname, 'public'),
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
