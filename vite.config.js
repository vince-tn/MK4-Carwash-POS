import process from 'node:process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vercel builds `main` as Production, with the live database's address and
// key from its settings. Every other branch (`staging`, pull requests) is a
// Preview, and Previews take the staging database from .env.staging. So only
// `main` can ever reach the shop's real data.
const staging = process.env.VERCEL_ENV === 'preview'

// https://vite.dev/config/
export default defineConfig({
  ...(staging && { mode: 'staging' }),
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
