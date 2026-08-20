// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/tanstack/vite";

// Deploy target: Lovable/Cloudflare by default; Vercel builds get the `vercel` preset
// so the SSR server + static assets land in .vercel/output instead of a Worker bundle.
const preset = process.env["NITRO_PRESET"] ?? (process.env["VERCEL"] ? "vercel" : undefined);

export default defineConfig({
  vite: {
    // Keep every emitted client asset rooted at the deployment host. This prevents
    // nested SSR routes from resolving CSS and scripts relative to their pathname.
    base: "/",
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  nitro: {
    ...(preset ? { preset } : {}),
    baseURL: "/",
  },
  plugins: [mcpPlugin()],
});
