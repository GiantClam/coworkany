import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
    clearScreen: false,
    server: {
        port: 5173,
        strictPort: true,
        watch: {
            // Ignore .coworkany directory to prevent constant reloads from sessions.json updates
            ignored: ['**/.coworkany/**', '**/src-tauri/.coworkany/**'],
        },
    },
    envPrefix: ['VITE_', 'TAURI_'],
    build: {
        target: process.env.TAURI_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
        minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
        sourcemap: !!process.env.TAURI_DEBUG,
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (!id.includes('node_modules')) {
                        return undefined;
                    }
                    if (id.includes('/node_modules/@assistant-ui/')) {
                        return 'assistant-ui-vendor';
                    }
                    if (id.includes('/node_modules/react-markdown/')
                        || id.includes('/node_modules/remark-gfm/')
                        || id.includes('/node_modules/mdast-util-')
                        || id.includes('/node_modules/micromark')) {
                        return 'markdown-vendor';
                    }
                    if (id.includes('/node_modules/react-syntax-highlighter/')
                        || id.includes('/node_modules/refractor/')
                        || id.includes('/node_modules/highlight.js/')) {
                        return 'syntax-vendor';
                    }
                    if (id.includes('/node_modules/@tauri-apps/')) {
                        return 'tauri-vendor';
                    }
                    if (id.includes('/node_modules/react/')
                        || id.includes('/node_modules/react-dom/')
                        || id.includes('/node_modules/scheduler/')) {
                        return 'react-vendor';
                    }
                    return undefined;
                },
            },
        },
    },
});
