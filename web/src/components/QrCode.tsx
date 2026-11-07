import qrcode from 'qrcode-generator'

// A QR code as plain SVG <rect>s, so it sits inside the share card's SVG and
// survives the PNG export. Dark modules on a light tile with a 4-module quiet
// zone: scanners need the contrast and the margin, whatever the card's theme.
export function QrCode({ text, x, y, size }: { text: string; x: number; y: number; size: number }) {
  const qr = qrcode(0, 'M') // type 0 = smallest version that fits
  qr.addData(text)
  qr.make()
  const count = qr.getModuleCount()
  const quiet = 4
  const cell = size / (count + quiet * 2)
  const rects = []
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) {
        rects.push(<rect key={`${r}-${c}`} x={(c + quiet) * cell} y={(r + quiet) * cell} width={cell + 0.3} height={cell + 0.3} fill="#0A0A0B" />)
      }
    }
  }
  return (
    <g transform={`translate(${x} ${y})`} role="img" aria-label={`QR code linking to ${text}`}>
      <rect width={size} height={size} rx={8} fill="#F5F5F7" />
      {rects}
    </g>
  )
}
