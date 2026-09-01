// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Deploy target: Lovable/Cloudflare by default; Vercel builds get the `vercel` preset
// so the SSR server + static assets land in .vercel/output instead of a Worker bundle.
const preset = process.env["NITRO_PRESET"] ?? (process.env["VERCEL"] ? "vercel" : undefined);

// Unique per build; injected into the client bundle so asset URLs change every deploy.
const buildId = process.env["VERCEL_GIT_COMMIT_SHA"]?.slice(0, 8) ?? Date.now().toString(36);

export default defineConfig({
  vite: {
    // Keep every emitted client asset rooted at the deployment host. This prevents
    // nested SSR routes from resolving CSS and scripts relative to their pathname.
    base: "/",
    define: {
      __BUILD_ID__: JSON.stringify(buildId),
    },
    // 🟢 SET THE CORE TRANSFORMER STRATEGY
    css: {
      transformer: "postcss", // Overrides LightningCSS for pre-transform rules
    },
    build: {
      target: "es2022", // Standardizes modern JavaScript/CSS selector translation
      cssMinify: "esbuild", // 🟢 FORCE ESBUILD TO COMPILE THE CSS WITHOUT DIACRITICAL WRONG IDENTIFIER CRASHES
      chunkSizeWarningLimit: 1600, // Raises the warning trigger threshold from 500kB to 1.6MB
      rollupOptions: {
        output: {
          // Content-hashed filenames so a new deploy can never reuse a stale cached file.
          entryFileNames: "assets/[name]-[hash].js",
          chunkFileNames: "assets/[name]-[hash].js",
          assetFileNames: "assets/[name]-[hash][extname]",
        },
      },
    },
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  // 🟢 Configure Nitro to inline imports on server bundles and eliminate __exportAll TDZ circular chunks
  nitro: {
    ...(preset ? { preset } : {}),
    rollupConfig: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
  // 🟢 MCP Plugin completely removed to halt background token syncing and preserve credits
  plugins: [],
});
