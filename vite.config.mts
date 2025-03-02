import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
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
  },
});
