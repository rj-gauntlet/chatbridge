import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: { entryFileNames: 'index.js', assetFileNames: 'index.[ext]' },
    },
  },
  server: { port: 5176 },
})
