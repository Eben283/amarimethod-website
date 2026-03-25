import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  base: "/staff/",
  build: {
    outDir: "../dist/staff",
    emptyOutDir: true,
  },
  server: {
    host: "::",
    port: 8082,
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
