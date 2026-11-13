import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

const buildDate = new Date().toLocaleDateString("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

// one id per build, baked into the bundle and written beside it as version.json so a running
// tab can tell when a newer build has been deployed (src/features/page/NewVersionBanner.tsx).
// Time plus randomness rather than the git sha: the Docker build context has no .git, and a
// rebuild of the same commit is still a new deployment the tab should pick up
const buildId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const versionFile = (): Plugin => ({
  name: "version-file",
  generateBundle() {
    this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ build: buildId }) });
  },
});

// Mol* is MIT, which requires its notice to travel with every copy, and the minifier drops
// the per-file headers that carry it. Added after minification, to whichever chunks hold
// Mol* modules, from the installed package's own LICENSE so the text cannot drift from the
// version shipped
const molstarLicence = (): Plugin => ({
  name: "molstar-licence",
  generateBundle(_options, bundle) {
    const pkg = JSON.parse(readFileSync("node_modules/molstar/package.json", "utf8"));
    const licence = readFileSync("node_modules/molstar/LICENSE", "utf8").replace(/\*\//g, "* /");
    const banner = `/*! molstar ${pkg.version} (https://molstar.org)\n${licence}\n*/\n`;
    for (const chunk of Object.values(bundle)) {
      if (chunk.type === "chunk" && chunk.moduleIds.some((id) => id.includes("/node_modules/molstar/"))) {
        chunk.code = banner + chunk.code;
      }
    }
  },
});

export default defineConfig({
  define: {
    __BUILD_DATE__: JSON.stringify(buildDate),
    __BUILD_ID__: JSON.stringify(buildId),
  },
  plugins: [react(), tsconfigPaths(), versionFile(), molstarLicence()],
  build: {
    outDir: "static",
    target: "esnext",
    rollupOptions: {
      output: {
        entryFileNames: "main.[hash].js",
      },
    },
  },
  server: {
    open: false,
    allowedHosts: ["anno.finngen.fi", "annopublic.finngen.fi", "dev.finngen.fi"],
    proxy: {
      // /api now goes through the standalone BFF (npm run bff:dev, default port 5000),
      // which forwards to the upstream genetics-results-api. mirrors the prod reverse-proxy
      // routing of /api -> BFF. previously this targeted :2000 (the API) directly.
      // no /chat entry: the chat calls use the absolute VITE_CHAT_URL in dev, so a proxy
      // key of /chat would only ever match the SPA routes (/chat, /chat/:sessionId) and
      // forward a page load upstream instead of serving the app.
      "/api": {
        target: "http://localhost:5000",
        changeOrigin: true,
      },
    },
  },
});
