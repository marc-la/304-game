/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { cpSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
// relative URLs. Classic (non-module) scripts and the monolithic
// stylesheet aren't bundled by Vite — they're served as-is from the
// site/ tree in dev and copied verbatim into dist/ on build. Files
// outside the Vite root (docs/) get copied here too.
//
// This list is intentionally explicit so a stray file dropped into
// site/css/ or docs/ doesn't silently ship to the live site.
const ASSETS_TO_COPY: Array<{ src: string; dst: string }> = [
  // Site stylesheet — loaded by every HTML page.
  { src: 'site/css/styles.css', dst: 'css/styles.css' },
  // Classic (non-module) scripts loaded by individual pages.
  // theme.js is loaded by all pages; the others are page-specific.
  { src: 'site/js/theme.js', dst: 'js/theme.js' },
  { src: 'site/js/hero-reveal.js', dst: 'js/hero-reveal.js' },
  { src: 'site/js/site-nav.js', dst: 'js/site-nav.js' },
  { src: 'site/js/rules.js', dst: 'js/rules.js' },
  { src: 'site/js/stats.js', dst: 'js/stats.js' },
  // Data fetched at runtime by stats.js.
  { src: 'docs/stats.xlsx', dst: 'docs/stats.xlsx' },
  { src: 'docs/bets', dst: 'docs/bets' },
];

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
  plugins: [htmlPartials(), react(), copyRepoAssets()],
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
