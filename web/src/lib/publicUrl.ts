// Where a shared link should point.
//   1. VITE_PUBLIC_URL (web/.env), the deployed address -- printed and in the QR.
//   2. Running locally: this machine's LAN address, so a phone on the same
//      Wi-Fi can scan the QR. Not printed: an IP address on a card is noise.
//   3. Otherwise the page's own origin.
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\]|.*\.localhost)$/

export type ShareTarget = { base: string; label: string | null }

export function shareTarget(): ShareTarget | null {
  const configured = (import.meta.env.VITE_PUBLIC_URL as string | undefined)?.trim()
  if (configured) {
    const base = configured.replace(/\/+$/, '')
    return { base, label: base.replace(/^https?:\/\//, '') }
  }
  if (LOCAL.test(window.location.hostname)) {
    return __LAN_ORIGIN__ ? { base: __LAN_ORIGIN__, label: null } : null
  }
  return { base: window.location.origin, label: window.location.host }
}
