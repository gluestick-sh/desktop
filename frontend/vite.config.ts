import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    host: '0.0.0.0', // allow external access
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      // Prefer JS rollup build to avoid native module issues
    },
  },
  oxc: {
    target: 'es2020',
  },
})
