import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  base: "/portal/",
  build: {
    outDir: "../dist/portal",
    emptyOutDir: true,
  },
  server: {
    host: "::",
    port: 8081,
    proxy: {
      "/api": {
        target: "https://www.amarimethod.com",
        changeOrigin: true,
        secure: true,
      },
    },
  },
  plugins: [react()],
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@amari/calendar": path.resolve(__dirname, "../shared/amari-calendar"),
      react: path.resolve(__dirname, "./node_modules/react"),
      "react-dom": path.resolve(__dirname, "./node_modules/react-dom"),
      "react/jsx-runtime": path.resolve(__dirname, "./node_modules/react/jsx-runtime.js"),
    },
  },
});
