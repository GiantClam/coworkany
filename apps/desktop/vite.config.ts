import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/postcss";
import { resolve } from "node:path";

export default defineConfig({
  // Tauri serves packaged assets from its `tauri://localhost` protocol. Use
  // relative URLs so the embedded WebView can resolve JS, CSS, and images in
  // both packaged builds and the development server.
  base: "./",
  plugins: [react()],
  resolve: { alias: [
    { find: "@coworkany/workbench-ui/styles.css", replacement: resolve(__dirname, "../../packages/workbench-ui/src/styles.css") },
    { find: "@coworkany/workbench-ui", replacement: resolve(__dirname, "../../packages/workbench-ui/src/index.ts") },
  ] },
  css: { postcss: { plugins: [tailwindcss()] } },
  clearScreen: false,
  server: {
    strictPort: true,
    port: 1420,
    // Desktop runtime projects live under the Tauri target directory. Skills
    // write intermediate HTML/SVG/PPTX files there; those files are runtime
    // data, not frontend source and must not reload the WebView mid-run.
    watch: { ignored: ["**/src-tauri/target/**"] },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
