import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './', // relative paths so app works at any subpath (Railway /apps/chess/ or Vercel root)
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        entryFileNames: 'index.js',
        assetFileNames: 'index.[ext]',
        format: 'iife',           // Avoids type="module" in HTML — required for sandboxed iframes
        name: 'ChessApp',         // IIFE global name (not used externally)
        inlineDynamicImports: true,
      },
    },
  },
  server: { port: 5174 },
})
