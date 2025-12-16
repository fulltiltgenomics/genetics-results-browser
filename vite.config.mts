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
  },
});
