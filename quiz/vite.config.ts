import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig({
  base: "/quiz/",  // CRITICAL: Assets will be served from /quiz/assets/
  build: {
    outDir: "../dist/quiz",  // Output to dist/quiz
    emptyOutDir: true,
    // Smaller initial bundle = faster LCP. React + ReactDOM stay in vendor;
    // results page (only seen by ~5% of visitors who finish) splits out.
    rollupOptions: {
      output: {
        manualChunks: {
          "react-vendor": ["react", "react-dom"],
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
