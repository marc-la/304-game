/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { cpSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildLeaderboardData } from '../tools/leaderboard/build-data';

/**
 * Multi-page Vite setup.
 *
 * - Vite root: ``site/`` — HTML entries and shared chrome live there.
 * - React app sources live under ``apps/`` (304dle, play) and reach the
 *   pure-TS engine via the ``@engine/*`` alias resolving to ``engine/``.
 * - Output: ``frontend/dist/`` (relative to repoRoot). The Pages workflow
 *   uploads this directory verbatim.
 * - Dev server: ``npm run dev`` serves all pages at ``localhost:5173/``.
 *   ``/api`` is proxied to the FastAPI backend on port 8000.
 * - ``EXCLUDE_PLAY=1`` drops ``play.html`` from the build (e.g. emergency
 *   rollback of the vs-bots / multiplayer flow).
 */

const frontendDir = __dirname;
const repoRoot = resolve(frontendDir, '..');
const siteRoot = resolve(repoRoot, 'site');
const excludePlay = process.env.EXCLUDE_PLAY === '1';

// Copy non-Vite-managed assets that the static pages reference via
// relative URLs. Only classic (non-module) scripts and runtime-fetched
// data need this: `<script type="module">` sources and the stylesheet
// `<link>` are bundled by Vite and rewritten in the built HTML, so
// copying those would just ship dead duplicates.
//
// This list is intentionally explicit so a stray file dropped into
// site/js/ or data/ doesn't silently ship to the live site.
const ASSETS_TO_COPY: Array<{ src: string; dst: string }> = [
  // Classic (non-module) scripts loaded by individual pages.
  { src: 'site/js/hero-reveal.js', dst: 'js/hero-reveal.js' },
  { src: 'site/js/site-nav.js', dst: 'js/site-nav.js' },
  // Raw betting CSVs — linked for download from the history page.
  { src: 'data/bets', dst: 'data/bets' },
];

// Regenerate site/public/data/leaderboard.json from data/stats.xlsx and
// data/bets/*.csv on every dev-server start and build, so the leaderboard
// pages fetch pre-parsed JSON instead of shipping SheetJS to the client.
// Output is gitignored; the sources in data/ are the tracked truth.
const leaderboardData = (): Plugin => ({
  name: '304-leaderboard-data',
  buildStart() {
    try {
      buildLeaderboardData();
    } catch (err) {
      this.error(`leaderboard data build failed: ${err}`);
    }
  },
});

const copyRepoAssets = (): Plugin => ({
  name: '304-copy-repo-assets',
  apply: 'build',
  closeBundle() {
    const outDir = resolve(frontendDir, 'dist');
    for (const { src, dst } of ASSETS_TO_COPY) {
      const srcAbs = resolve(repoRoot, src);
      if (!existsSync(srcAbs)) continue;
      cpSync(srcAbs, resolve(outDir, dst), { recursive: true });
    }
  },
});

// Dev-only: make /apps/, /engine/, /data/ URLs reachable even though
// they live outside the Vite root (site/). We rewrite the request to
// Vite's /@fs/<absolute-path> escape hatch — server.fs.allow already
// permits the repo root, so the .tsx/.ts files go through Vite's
// transform pipeline like any in-root source.
//
// In production this is a no-op: the build bundles the @engine imports
// via Rollup, and the copyRepoAssets plugin already places data/ at the
// right URL in dist/.
const externalDirsServe = (): Plugin => ({
  name: '304-external-dirs-serve',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      const url = req.url ?? '';
      const path = url.split('?')[0];
      if (/^\/(apps|engine|data)\//.test(path)) {
        req.url = '/@fs' + repoRoot + url;
      }
      next();
    });
  },
});

// HTML partial includes. Replaces `<!-- @include partials/foo.html -->` in
// every served/built HTML page with the contents of `site/partials/foo.html`.
// Runs in both dev and build via `transformIndexHtml`, so the header (and
// other shared chrome) is baked into the HTML the browser receives — no
// runtime injection, no flicker.
const htmlPartials = (): Plugin => ({
  name: '304-html-partials',
  enforce: 'pre',
  transformIndexHtml: {
    order: 'pre',
    handler(html) {
      return html.replace(
        /<!--\s*@include\s+([\w./-]+)\s*-->/g,
        (_match, rel: string) => {
          const partialPath = resolve(siteRoot, rel);
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
  index: resolve(siteRoot, 'index.html'),
  rules: resolve(siteRoot, 'rules.html'),
  cheatsheet: resolve(siteRoot, 'cheatsheet.html'),
  capsFormalism: resolve(siteRoot, 'caps-formalism.html'),
  stats: resolve(siteRoot, 'stats.html'),
  practice: resolve(siteRoot, 'practice.html'),
};
if (!excludePlay) {
  buildInputs.play = resolve(siteRoot, 'play.html');
}

export default defineConfig({
  plugins: [leaderboardData(), htmlPartials(), react(), copyRepoAssets(), externalDirsServe()],
  root: siteRoot,
  // Relative asset paths so the build can be served from any subpath
  // (e.g. ``user.github.io/304-game/``) without rewriting hrefs.
  base: './',
  // Static assets that aren't referenced by HTML directly (e.g. the
  // pre-baked daily puzzles loaded by 304dle at runtime). Files here
  // are copied verbatim into ``dist/``.
  publicDir: resolve(siteRoot, 'public'),
  resolve: {
    alias: {
      '@engine': resolve(repoRoot, 'engine'),
      '@apps': resolve(repoRoot, 'apps'),
    },
  },
  build: {
    outDir: resolve(frontendDir, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: buildInputs,
    },
  },
  server: {
    // Allow Vite dev to reach apps/ and engine/ outside siteRoot.
    fs: {
      allow: [repoRoot],
    },
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  test: {
    // Vitest shares this config; tests live outside siteRoot under
    // engine/, apps/, and tools/. Anchor discovery at repoRoot.
    root: repoRoot,
    include: [
      'engine/**/*.{test,spec}.{ts,tsx}',
      'apps/**/*.{test,spec}.{ts,tsx}',
      'tools/**/*.{test,spec}.{ts,tsx}',
    ],
  },
});
