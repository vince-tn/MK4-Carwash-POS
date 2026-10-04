import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        // The libraries change far less often than the app. In chunks of
        // their own they stay cached in the browser across app deploys, so
        // an update only downloads the app's own code. The pages are split
        // by the lazy imports in App.jsx, which keeps the charts library out
        // of everything but the dashboard.
        codeSplitting: {
          groups: [
            {
              name: 'react',
              test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
              priority: 20,
            },
            {
              name: 'supabase',
              test: /node_modules[\\/]@supabase[\\/]/,
              priority: 10,
            },
          ],
        },
      },
    },
  },
})
