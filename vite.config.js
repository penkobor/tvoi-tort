import { defineConfig } from 'vite'

// Relative base: the build works under any GitHub Pages repo name.
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 900,
  },
})
