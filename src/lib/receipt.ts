type ReceiptData = {
  bookingCode: string
  customerName: string
  customerPhone: string
  courtName: string
  bookingDate: string
  startTime: string
  endTime: string
  amount: string
  paidAt: string
}

function pdfText(value: unknown) {
  return String(value ?? '').replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)')
}

export function buildReceiptPdf(data: ReceiptData) {
  const row = (y: number, label: string, value: string) => [
    '0.95 0.97 0.96 rg',
    `72 ${y - 18} 130 28 re f`,
    '0.98 0.98 0.98 rg',
    `202 ${y - 18} 321 28 re f`,
    '0.82 0.86 0.84 RG 0.5 w',
    `72 ${y - 18} 451 28 re S`,
    '0.22 0.29 0.27 rg',
    `BT /F2 10 Tf 88 ${y - 1} Td (${pdfText(label)}) Tj ET`,
    '0.08 0.10 0.12 rg',
    `BT /F1 10 Tf 218 ${y - 1} Td (${pdfText(value)}) Tj ET`,
  ].join('\n')

  const content = [
    '0.99 1 0.99 rg 0 0 595 842 re f',
    '0.04 0.28 0.18 rg 0 742 595 100 re f',
    '0.55 0.84 0.32 rg 72 740 110 4 re f',
    '1 1 1 rg BT /F2 22 Tf 72 790 Td (BMTennis Receipt) Tj ET',
    '0.82 0.93 0.87 rg BT /F1 10 Tf 72 768 Td (Bukti pembayaran booking lapangan tenis) Tj ET',
    '0.82 0.93 0.87 rg BT /F2 12 Tf 420 790 Td (LUNAS) Tj ET',
    '1 1 1 rg 72 580 451 120 re f',
    '0.88 0.91 0.89 RG 1 w 72 580 451 120 re S',
    '0.04 0.28 0.18 rg BT /F2 13 Tf 96 672 Td (Ringkasan Pembayaran) Tj ET',
    `0.08 0.10 0.12 rg BT /F2 24 Tf 96 635 Td (${pdfText(data.amount)}) Tj ET`,
    `0.35 0.39 0.38 rg BT /F1 10 Tf 96 612 Td (Kode booking: ${pdfText(data.bookingCode)}) Tj ET`,
    `0.35 0.39 0.38 rg BT /F1 10 Tf 96 594 Td (Dibayar pada: ${pdfText(data.paidAt)}) Tj ET`,
    '0.04 0.28 0.18 rg BT /F2 14 Tf 72 535 Td (Detail Booking) Tj ET',
    row(500, 'Nama customer', data.customerName),
    row(466, 'Nomor WhatsApp', data.customerPhone),
    row(432, 'Lapangan', data.courtName),
    row(398, 'Tanggal', data.bookingDate),
    row(364, 'Jam', `${data.startTime}-${data.endTime}`),
    row(330, 'Status', 'Pembayaran lunas'),
    '0.35 0.39 0.38 rg BT /F1 9 Tf 72 92 Td (Receipt ini dibuat otomatis oleh sistem BMTennis setelah pembayaran diterima.) Tj ET',
    '0.04 0.28 0.18 rg 72 74 451 2 re f',
  ].join('\n')

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ]

  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf))
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`

  return new Response(pdf, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="receipt-${data.bookingCode}.pdf"`,
    },
  })
}
