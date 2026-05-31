import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

const buildDate = new Date().toLocaleDateString("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export default defineConfig({
  define: {
    __BUILD_DATE__: JSON.stringify(buildDate),
  },
  plugins: [react(), tsconfigPaths()],
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
      "/api": {
        target: "http://localhost:5000",
        changeOrigin: true,
      },
      "/chat": {
        target: "https://dev.finngen.fi",
        changeOrigin: true,
        secure: true,
      },
    },
  },
});
