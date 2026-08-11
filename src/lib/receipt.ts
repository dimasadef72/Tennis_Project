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
  const lines = [
    'BMTennis Payment Receipt',
    '',
    `Kode booking: ${data.bookingCode}`,
    `Nama: ${data.customerName}`,
    `Nomor WhatsApp: ${data.customerPhone}`,
    `Lapangan: ${data.courtName}`,
    `Tanggal: ${data.bookingDate}`,
    `Jam: ${data.startTime}-${data.endTime}`,
    `Total pembayaran: ${data.amount}`,
    `Dibayar pada: ${data.paidAt}`,
    '',
    'Status: LUNAS',
  ]

  const content = [
    'BT',
    '/F1 18 Tf',
    '72 760 Td',
    `(${pdfText(lines[0])}) Tj`,
    '/F1 11 Tf',
    ...lines.slice(1).flatMap((line) => ['0 -24 Td', `(${pdfText(line)}) Tj`]),
    'ET',
  ].join('\n')

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
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
