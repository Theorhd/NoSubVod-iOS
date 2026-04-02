import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";

export default defineConfig({
  root: __dirname,
  base: "/",
  cacheDir: "../../node_modules/.vite-portal",
  plugins: [react(), basicSsl()],
  build: {
    outDir: "../../dist/portal",
    emptyOutDir: true,
    cssCodeSplit: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;

          if (
            id.includes("node_modules/react") ||
            id.includes("node_modules/react-dom")
          ) {
            return "react-vendor";
          }

          if (id.includes("node_modules/react-router")) {
            return "router-vendor";
          }

          if (
            id.includes("node_modules/@vidstack") ||
            id.includes("node_modules/vidstack")
          ) {
            return "vidstack-vendor";
          }

          if (id.includes("node_modules/hls.js")) {
            return "hls-vendor";
          }

          if (id.includes("node_modules/@tauri-apps")) {
            return "tauri-vendor";
          }

          if (id.includes("node_modules/lucide-react")) {
            return "icons-vendor";
          }
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    host: true,
    https: {},
    proxy: {
      "/api": {
        target: "http://localhost:23455",
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
