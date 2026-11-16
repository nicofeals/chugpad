import { defineConfig } from 'vite';

// Relative base so the build works under https://<user>.github.io/<repo>/ and on any other path.
export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 900 }
});
