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
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
