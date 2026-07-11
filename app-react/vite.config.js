import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// Production builds are served from the GitHub Pages project subpath
// (https://<user>.github.io/complex-interface-demo/); dev stays at root.
// All data/asset URLs derive from import.meta.env.BASE_URL, so this is the only place the path lives.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/complex-interface-demo/' : '/',
  plugins: [react()],
  server: { port: 5173 },
}))
