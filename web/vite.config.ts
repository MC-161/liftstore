import { networkInterfaces } from 'node:os'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// This machine's address on the local network, so the share card's QR code
// opens on a phone on the same Wi-Fi during development. Only used when
// VITE_PUBLIC_URL is unset; the deployed site uses its real address.
function lanAddress(): string | null {
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family === 'IPv4' && !a.internal) return a.address
    }
  }
  return null
}

const PORT = 5173
const lan = lanAddress()

// /api goes to the Go gateway. Same origin in dev, so no CORS round trip and
// the page works whatever device opens it.
export default defineConfig({
  plugins: [react()],
  define: {
    __LAN_ORIGIN__: JSON.stringify(lan ? `http://${lan}:${PORT}` : null),
  },
  server: {
    port: PORT,
    // Listen on the LAN, not just loopback, so the QR code's link opens on a
    // phone. Anyone on the same network can reach the dev server.
    host: true,
    proxy: { '/api': 'http://localhost:8080' },
  },
  // `npm run build && npm run preview`: the production bundle, same proxy.
  preview: {
    proxy: { '/api': 'http://localhost:8080' },
  },
})
