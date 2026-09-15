import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/mermaid')) {
            return 'mermaid';
          }
          if (id.includes('node_modules/@xterm')) {
            return 'xterm';
          }
          if (id.includes('node_modules/prismjs')) {
            return 'prismjs';
          }
          if (id.includes('node_modules/react-markdown') || id.includes('node_modules/remark-gfm') || id.includes('node_modules/micromark')) {
            return 'markdown';
          }
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/')) {
            return 'vendor';
          }
          if (id.includes('node_modules/lucide-react')) {
            return 'icons';
          }
        },
      },
    },
  },
})
