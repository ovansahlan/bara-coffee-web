import { formatDateIndo, formatDateTimeShort, formatRp } from './calc';
import type { PayrollItemRecord } from './types';

export interface PayslipPdfInput {
  periodLabel: string;
  fromDate: string;
  toDate: string;
  status: 'draft' | 'paid';
  paidAt: string | null;
  outletName: string;
  item: PayrollItemRecord;
}

function toAscii(text: string): string {
  return String(text || '')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u00B7/g, '|')
    .replace(/\u2192/g, '->')
    .replace(/\u2713/g, 'OK')
    .replace(/[^\x20-\x7E]/g, ' ');
}

function pdfEsc(text: string): string {
  return toAscii(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function approxWidth(text: string, fontSize: number, bold = false): number {
  const s = toAscii(text);
  let factor = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === ' ' || ch === '.' || ch === ',' || ch === ':' || ch === 'i' || ch === 'l' || ch === '|') {
      factor += 0.29;
    } else if (ch >= '0' && ch <= '9') {
      factor += 0.56;
    } else if (ch >= 'A' && ch <= 'Z') {
      factor += bold ? 0.68 : 0.64;
    } else {
      factor += bold ? 0.54 : 0.51;
    }
  }
  return factor * fontSize;
}

export function generatePayslipPdfBytes(input: PayslipPdfInput): Uint8Array {
  const { item } = input;
  const W = 595;
  const H = 842;
  const M = 40;
  const CW = W - M * 2; // 515

  const cmds: string[] = [];

  const drawText = (
    x: number,
    yTop: number,
    text: string,
    size = 10,
    bold = false,
    rgb: [number, number, number] = [0.122, 0.098, 0.082],
    align: 'left' | 'right' | 'center' = 'left'
  ) => {
    const clean = toAscii(text);
    const py = H - yTop;
    let px = x;
    const w = approxWidth(clean, size, bold);
    if (align === 'right') px = x - w;
    else if (align === 'center') px = x - w / 2;

    cmds.push('BT');
    cmds.push(`/${bold ? 'F2' : 'F1'} ${size} Tf`);
    cmds.push(`${rgb[0].toFixed(3)} ${rgb[1].toFixed(3)} ${rgb[2].toFixed(3)} rg`);
    cmds.push(`1 0 0 1 ${px.toFixed(2)} ${py.toFixed(2)} Tm`);
    cmds.push(`(${pdfEsc(clean)}) Tj`);
    cmds.push('ET');
  };

  const fillRect = (x: number, yTop: number, w: number, h: number, rgb: [number, number, number]) => {
    const py = H - yTop - h;
    cmds.push(`${rgb[0].toFixed(3)} ${rgb[1].toFixed(3)} ${rgb[2].toFixed(3)} rg`);
    cmds.push(`${x.toFixed(2)} ${py.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
  };

  const strokeRect = (
    x: number,
    yTop: number,
    w: number,
    h: number,
    rgb: [number, number, number],
    lineWidth = 0.75
  ) => {
    const py = H - yTop - h;
    cmds.push(`${lineWidth.toFixed(2)} w`);
    cmds.push(`${rgb[0].toFixed(3)} ${rgb[1].toFixed(3)} ${rgb[2].toFixed(3)} RG`);
    cmds.push(`${x.toFixed(2)} ${py.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re S`);
  };

  const drawLine = (
    x1: number,
    y1Top: number,
    x2: number,
    y2Top: number,
    rgb: [number, number, number],
    lineWidth = 0.6
  ) => {
    cmds.push(`${lineWidth.toFixed(2)} w`);
    cmds.push(`${rgb[0].toFixed(3)} ${rgb[1].toFixed(3)} ${rgb[2].toFixed(3)} RG`);
    cmds.push(`${x1.toFixed(2)} ${(H - y1Top).toFixed(2)} m ${x2.toFixed(2)} ${(H - y2Top).toFixed(2)} l S`);
  };

  const COFFEE: [number, number, number] = [0.004, 0.149, 0.412];
  const DARK: [number, number, number] = [0.043, 0.098, 0.2];
  const MUTED: [number, number, number] = [0.345, 0.416, 0.522];
  const CREAM: [number, number, number] = [0.961, 0.973, 0.988];
  const SAND: [number, number, number] = [0.91, 0.941, 0.98];
  const BORDER: [number, number, number] = [0.824, 0.867, 0.925];
  const WHITE: [number, number, number] = [1, 1, 1];
  const GREEN: [number, number, number] = [0.082, 0.502, 0.239];
  const RED: [number, number, number] = [0.863, 0.149, 0.149];

  // 1. Brand Header Banner
  fillRect(M, 36, CW, 72, COFFEE);
  drawText(M + 18, 63, 'BARA COFFEE', 18, true, WHITE, 'left');
  drawText(M + 18, 82, 'SLIP GAJI KARYAWAN / OFFICIAL PAYSLIP', 9, false, [0.84, 0.89, 0.96], 'left');
  drawText(M + 18, 96, input.outletName, 9, true, WHITE, 'left');

  drawText(M + CW - 18, 62, input.periodLabel, 12, true, WHITE, 'right');
  drawText(
    M + CW - 18,
    79,
    `${formatDateIndo(input.fromDate)} - ${formatDateIndo(input.toDate)}`,
    8.5,
    false,
    [0.84, 0.89, 0.96],
    'right'
  );
  drawText(
    M + CW - 18,
    95,
    input.status === 'paid' ? 'STATUS: DIBAYAR (LUNAS)' : 'STATUS: DRAFT',
    8.5,
    true,
    WHITE,
    'right'
  );

  // 2. Employee Info Box
  let y = 124;
  fillRect(M, y, CW, 92, CREAM);
  strokeRect(M, y, CW, 92, BORDER, 0.8);
  drawLine(M + CW / 2, y + 10, M + CW / 2, y + 82, BORDER, 0.6);

  const leftColX = M + 14;
  const leftValX = M + 96;
  const rightColX = M + CW / 2 + 14;
  const rightValX = M + CW / 2 + 104;

  drawText(leftColX, y + 22, 'Nama Karyawan', 9, false, MUTED);
  drawText(leftValX, y + 22, `: ${item.employeeName}`, 9.5, true, DARK);

  drawText(leftColX, y + 40, 'Jabatan', 9, false, MUTED);
  drawText(leftValX, y + 40, `: ${item.roleTitle}`, 9.5, false, DARK);

  drawText(leftColX, y + 58, 'Penempatan', 9, false, MUTED);
  drawText(leftValX, y + 58, `: ${input.outletName}`, 9.5, false, DARK);

  drawText(leftColX, y + 76, 'Skema Gaji', 9, false, MUTED);
  drawText(
    leftValX,
    y + 76,
    `: ${item.payType === 'daily' ? 'Part-Time Harian' : 'Bulanan (Full-Time)'}`,
    9.5,
    true,
    COFFEE
  );

  drawText(rightColX, y + 22, 'Kehadiran', 9, false, MUTED);
  drawText(
    rightValX,
    y + 22,
    `: ${item.daysPresent} hadir${item.fullShiftCount ? ` (${item.fullShiftCount}x full shift)` : ''}`,
    9.5,
    true,
    DARK
  );

  drawText(rightColX, y + 40, 'Telat / Alpha', 9, false, MUTED);
  drawText(rightValX, y + 40, `: ${item.lateCount}x telat | ${item.absentCount}x alpha`, 9.5, false, DARK);

  drawText(rightColX, y + 58, 'Total Lembur', 9, false, MUTED);
  drawText(rightValX, y + 58, `: ${item.overtimeHours} jam`, 9.5, false, DARK);

  drawText(rightColX, y + 76, 'Tanggal Bayar', 9, false, MUTED);
  drawText(
    rightValX,
    y + 76,
    `: ${input.paidAt ? formatDateTimeShort(input.paidAt) + ' WIB' : 'Belum dibayar'}`,
    9,
    false,
    DARK
  );

  // 3. Earnings Table (PENDAPATAN)
  y += 108;
  const drawTableSection = (
    startY: number,
    title: string,
    rows: Array<{ label: string; sub?: string; amount: number }>,
    totalLabel: string,
    totalAmount: number,
    totalRgb: [number, number, number],
    prefix = ''
  ): number => {
    const rowH = 24;
    const headerH = 26;
    const totalH = 28;
    const boxH = headerH + rows.length * rowH + totalH;

    fillRect(M, startY, CW, headerH, SAND);
    strokeRect(M, startY, CW, boxH, BORDER, 0.8);
    drawText(M + 14, startY + 17, title, 9.5, true, DARK);
    drawText(M + CW - 14, startY + 17, 'NOMINAL (IDR)', 8.5, true, MUTED, 'right');

    let cy = startY + headerH;
    rows.forEach((r, idx) => {
      if (idx > 0) drawLine(M, cy, M + CW, cy, BORDER, 0.45);
      drawText(M + 14, cy + 16, r.label + (r.sub ? ` (${r.sub})` : ''), 9.5, false, DARK);
      drawText(M + CW - 14, cy + 16, `${prefix}${formatRp(r.amount)}`, 9.5, false, DARK, 'right');
      cy += rowH;
    });

    fillRect(M, cy, CW, totalH, CREAM);
    drawLine(M, cy, M + CW, cy, BORDER, 0.8);
    drawText(M + 14, cy + 18, totalLabel, 9.5, true, DARK);
    drawText(M + CW - 14, cy + 18, `${prefix}${formatRp(totalAmount)}`, 10, true, totalRgb, 'right');

    return startY + boxH;
  };

  y = drawTableSection(
    y,
    'A. RINCIAN PENDAPATAN',
    [
      {
        label: item.payType === 'daily' ? 'Upah Part-Time Harian' : 'Gaji Pokok Bulanan',
        amount: item.basePay,
      },
      { label: 'Uang Makan / Transport', amount: item.mealTotal },
      { label: 'Upah Lembur', amount: item.overtimePay },
      { label: 'Bonus / Insentif', amount: item.bonus },
    ],
    'TOTAL PENDAPATAN KOTOR',
    item.grossPay,
    GREEN
  );

  // 4. Deductions Table (POTONGAN)
  y += 16;
  const totalDeductions = item.lateDeduction + item.kasbonDeduction + item.otherDeduction;
  y = drawTableSection(
    y,
    'B. RINCIAN POTONGAN',
    [
      {
        label: 'Potongan Keterlambatan',
        sub: item.lateCount > 0 ? `${item.lateCount}x telat` : undefined,
        amount: item.lateDeduction,
      },
      {
        label: 'Potongan Cicilan / Pelunasan Kasbon',
        sub:
          item.activeKasbonBefore > 0
            ? `Saldo kasbon sebelum: ${formatRp(item.activeKasbonBefore)}`
            : undefined,
        amount: item.kasbonDeduction,
      },
      { label: 'Potongan Lainnya', amount: item.otherDeduction },
    ],
    'TOTAL POTONGAN',
    totalDeductions,
    RED,
    '-'
  );

  // 5. Net Pay Highlight Box
  y += 18;
  fillRect(M, y, CW, 48, SAND);
  strokeRect(M, y, CW, 48, COFFEE, 1.4);
  drawText(M + 16, y + 21, 'GAJI BERSIH DITERIMA (TAKE HOME PAY)', 10, true, COFFEE);
  drawText(M + 16, y + 36, 'Pendapatan Kotor dikurangi Total Potongan', 8.5, false, MUTED);
  drawText(M + CW - 16, y + 30, formatRp(item.netPay), 15, true, COFFEE, 'right');

  // 6. Optional Note
  y += 64;
  if (item.note) {
    fillRect(M, y, CW, 34, CREAM);
    strokeRect(M, y, CW, 34, BORDER, 0.6);
    drawText(M + 12, y + 14, 'Catatan:', 8.5, true, MUTED);
    drawText(M + 12, y + 27, item.note.slice(0, 95), 9, false, DARK);
    y += 48;
  }

  // 7. Signature Block
  const sigY = Math.max(y + 12, 680);
  drawText(M + 75, sigY, 'Disetujui Oleh,', 9, false, MUTED, 'center');
  drawLine(M + 15, sigY + 46, M + 135, sigY + 46, BORDER, 0.8);
  drawText(M + 75, sigY + 60, 'Owner Bara Coffee', 9, true, DARK, 'center');

  drawText(M + CW - 75, sigY, 'Diterima Oleh,', 9, false, MUTED, 'center');
  drawLine(M + CW - 135, sigY + 46, M + CW - 15, sigY + 46, BORDER, 0.8);
  drawText(M + CW - 75, sigY + 60, item.employeeName, 9, true, DARK, 'center');

  // Footer
  drawLine(M, 792, M + CW, 792, BORDER, 0.5);
  drawText(
    M,
    808,
    'Dokumen ini diterbitkan secara elektronik oleh sistem Bara Coffee.',
    8,
    false,
    MUTED
  );
  drawText(M + CW, 808, `ID: ${item.employeeId}`, 8, false, MUTED, 'right');

  // Assemble valid PDF 1.4 byte stream with exact xref offsets
  const encoder = new TextEncoder();
  const streamStr = cmds.join('\n') + '\n';
  const streamBytes = encoder.encode(streamStr);

  const objects: string[] = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>\nendobj\n`,
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n',
    `6 0 obj\n<< /Length ${streamBytes.length} >>\nstream\n${streamStr}endstream\nendobj\n`,
  ];

  const chunks: Uint8Array[] = [];
  const offsets: number[] = [0];
  let bytePos = 0;

  const pushStr = (s: string) => {
    const b = encoder.encode(s);
    chunks.push(b);
    bytePos += b.length;
  };

  pushStr('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  for (const obj of objects) {
    offsets.push(bytePos);
    pushStr(obj);
  }

  const xrefStart = bytePos;
  pushStr(`xref\n0 ${objects.length + 1}\n`);
  pushStr('0000000000 65535 f \n');
  for (let i = 1; i < offsets.length; i++) {
    pushStr(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  }
  pushStr(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`);

  const out = new Uint8Array(bytePos);
  let cursor = 0;
  for (const c of chunks) {
    out.set(c, cursor);
    cursor += c.length;
  }
  return out;
}

export function downloadPayslipPdf(input: PayslipPdfInput): void {
  const bytes = generatePayslipPdfBytes(input);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const blob = new Blob([buffer], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const safeName = input.item.employeeName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const safePeriod = input.fromDate || 'periode';
  const a = document.createElement('a');
  a.href = url;
  a.download = `slip-gaji-${safeName}-${safePeriod}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
