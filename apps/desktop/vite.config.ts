import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/postcss";
import { resolve } from "node:path";

function manualChunk(id: string) {
  if (id === resolve(__dirname, "src/App.tsx")) return "desktop-app";
  if (id === resolve(__dirname, "src/generated-agency-agent-catalog.ts")) return "desktop-agent-catalog";
  if (!id.includes("/node_modules/.pnpm/")) return undefined;
  if (/\/\.pnpm\/(?:react|react-dom|scheduler)@/u.test(id)) return "vendor-react";
  if (/\/\.pnpm\/(?:ai@|@ai-sdk\+)/u.test(id)) return "vendor-ai";
  if (/\/\.pnpm\/(?:streamdown@|react-markdown@|remark-|rehype-|unified@|micromark|mdast-|hast-|parse5@|entities@|marked@|vfile@|character-entities@|decode-named-character-reference@|comma-separated-tokens@|property-information@|space-separated-tokens@|zwitch@|devlop@|bail@|trough@|is-plain-obj@|html-void-elements@|web-namespaces@)/u.test(id)) return "vendor-markdown";
  if (/\/\.pnpm\/(?:@radix-ui\+|@floating-ui\+)/u.test(id)) return "vendor-primitives";
  if (/\/\.pnpm\/(?:media-chrome@)/u.test(id)) return "vendor-media";
  return undefined;
}

export default defineConfig({
  // Tauri serves packaged assets from its `tauri://localhost` protocol. Use
  // relative URLs so the embedded WebView can resolve JS, CSS, and images in
  // both packaged builds and the development server.
  base: "./",
  plugins: [react()],
  optimizeDeps: { exclude: ["@silurus/ooxml"] },
  resolve: { alias: [
    { find: "@coworkany/workbench-ui/styles.css", replacement: resolve(__dirname, "../../packages/workbench-ui/src/styles.css") },
    { find: "@coworkany/workbench-ui/desktop", replacement: resolve(__dirname, "../../packages/workbench-ui/src/desktop-entry.ts") },
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
  build: {
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 700,
    rollupOptions: { output: { manualChunks: manualChunk } },
  },
});
