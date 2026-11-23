// ============================================================================
// Bara Coffee — Google Apps Script Sync Bridge
// Tempelkan kode ini di Google Sheet Anda: Extensions -> Apps Script -> Deploy -> Web app
// Execute as: Me | Who has access: Anyone
// ============================================================================

function doGet() {
  return ContentService.createTextOutput(
    JSON.stringify({ ok: true, message: 'Bara Coffee Google Sheets Sync Webhook aktif.' })
  ).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    var raw = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
    var payload = JSON.parse(raw);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var tabs = payload.tabs || {};

    var tabNames = [
      'Transaksi_Harian',
      'Pembelanjaan',
      'Setor_Owner_Bank',
      'Absensi',
      'Kasbon_Pinjaman',
      'Payroll',
      'Pengeluaran_Owner',
    ];

    var counts = {};
    for (var i = 0; i < tabNames.length; i++) {
      var name = tabNames[i];
      var rows = Array.isArray(tabs[name]) ? tabs[name] : [];
      var sheet = ss.getSheetByName(name);
      if (!sheet) {
        sheet = ss.insertSheet(name);
        if (name === 'Pengeluaran_Owner') {
          sheet.getRange(1, 1, 1, 7).setValues([[
            'Tanggal', 'Kategori', 'Outlet Terkait', 'Keterangan', 'Metode Bayar', 'Nominal (Rp)', 'Catatan'
          ]]).setBackground('#012669').setFontColor('#FFFFFF').setFontWeight('bold');
        }
      }

      var lastRow = sheet.getLastRow();
      var maxCols = Math.max(sheet.getLastColumn(), rows.length > 0 ? rows[0].length : 1);
      if (lastRow >= 2 && maxCols >= 1) {
        sheet.getRange(2, 1, lastRow - 1, maxCols).clearContent();
      }

      if (rows.length > 0) {
        sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
      }
      counts[name] = rows.length;
    }

    // Perbarui tab Ringkasan secara dinamis (Section A: Outlet, Section B: Kategori per Outlet, Section C: Absensi/Kasbon/Payroll, Section D: Pengeluaran Owner)
    if (Array.isArray(payload.outlets) && payload.outlets.length > 0) {
      rebuildSummarySheet(ss, payload.outlets, payload.categories, payload.ownerCategories);
    }

    return ContentService.createTextOutput(
      JSON.stringify({ ok: true, counts: counts, syncedAt: new Date().toISOString() })
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(
      JSON.stringify({ ok: false, error: String(err && err.message ? err.message : err) })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

function colLetter(n) {
  var s = '';
  while (n > 0) {
    var m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function rebuildSummarySheet(ss, outlets, categories, ownerCategories) {
  var sheet = ss.getSheetByName('Ringkasan');
  if (!sheet) return;

  var cats = Array.isArray(categories) && categories.length > 0
    ? categories
    : ['Minuman', 'Makanan', 'Lain-Lain'];

  var maxRows = sheet.getMaxRows();
  var maxCols = Math.max(sheet.getMaxColumns(), 12);
  if (maxRows >= 4) {
    sheet.getRange(4, 1, maxRows - 3, maxCols).clearContent().clearFormat();
  }

  // --- SECTION A: REKAP TRANSAKSI & BELANJA PER OUTLET ---
  var rTitleA = 4;
  var rHdrA = 5;
  var rStartA = 6;
  sheet.getRange(rTitleA, 1).setValue('A. REKAP TRANSAKSI & BELANJA PER OUTLET')
    .setFontWeight('bold').setFontSize(11).setFontColor('#012669');

  var hdrA = [[
    'Outlet', 'Total Penjualan (Rp)', 'Cash (Rp)', 'QRIS (Rp)',
    'GoFood (Rp)', 'GrabFood (Rp)', 'Belanja Kas Kecil (Rp)',
    'Setoran Owner/Bank (Rp)', 'Selisih Total (Rp)'
  ]];
  sheet.getRange(rHdrA, 1, 1, 9).setValues(hdrA)
    .setBackground('#012669').setFontColor('#FFFFFF').setFontWeight('bold').setWrap(true);

  var rowsA = [];
  for (var j = 0; j < outlets.length; j++) {
    var r = rStartA + j;
    rowsA.push([
      outlets[j],
      '=SUMIF(Transaksi_Harian!$B$2:$B, A' + r + ', Transaksi_Harian!$K$2:$K)',
      '=SUMIF(Transaksi_Harian!$B$2:$B, A' + r + ', Transaksi_Harian!$G$2:$G)',
      '=SUMIF(Transaksi_Harian!$B$2:$B, A' + r + ', Transaksi_Harian!$H$2:$H)',
      '=SUMIF(Transaksi_Harian!$B$2:$B, A' + r + ', Transaksi_Harian!$I$2:$I)',
      '=SUMIF(Transaksi_Harian!$B$2:$B, A' + r + ', Transaksi_Harian!$J$2:$J)',
      '=SUMIF(Pembelanjaan!$C$2:$C, A' + r + ', Pembelanjaan!$G$2:$G)',
      '=SUMIF(Setor_Owner_Bank!$C$2:$C, A' + r + ', Setor_Owner_Bank!$G$2:$G)',
      '=SUMIF(Transaksi_Harian!$B$2:$B, A' + r + ', Transaksi_Harian!$M$2:$M)',
    ]);
  }
  sheet.getRange(rStartA, 1, rowsA.length, 9).setValues(rowsA);
  sheet.getRange(rStartA, 2, rowsA.length, 8).setNumberFormat('#,##0');

  var rEndA = rStartA + outlets.length - 1;
  var rTotalA = rEndA + 1;
  sheet.getRange(rTotalA, 1, 1, 9).setValues([[
    'TOTAL SEMUA OUTLET',
    '=SUM(B' + rStartA + ':B' + rEndA + ')',
    '=SUM(C' + rStartA + ':C' + rEndA + ')',
    '=SUM(D' + rStartA + ':D' + rEndA + ')',
    '=SUM(E' + rStartA + ':E' + rEndA + ')',
    '=SUM(F' + rStartA + ':F' + rEndA + ')',
    '=SUM(G' + rStartA + ':G' + rEndA + ')',
    '=SUM(H' + rStartA + ':H' + rEndA + ')',
    '=SUM(I' + rStartA + ':I' + rEndA + ')',
  ]]).setBackground('#E8F0FA').setFontWeight('bold');
  sheet.getRange(rTotalA, 2, 1, 8).setNumberFormat('#,##0');

  // --- SECTION B: REKAP PEMBELANJAAN PER KATEGORI & OUTLET ---
  var rTitleB = rTotalA + 2;
  var rHdrB = rTitleB + 1;
  var rStartB = rHdrB + 1;
  var numColsB = cats.length + 2;
  var lastCatCol = colLetter(1 + cats.length);

  sheet.getRange(rTitleB, 1).setValue('B. REKAP PEMBELANJAAN PER KATEGORI & OUTLET')
    .setFontWeight('bold').setFontSize(11).setFontColor('#012669');

  var hdrB = ['Outlet'].concat(cats).concat(['Total Pembelanjaan (Rp)']);
  sheet.getRange(rHdrB, 1, 1, numColsB).setValues([hdrB])
    .setBackground('#012669').setFontColor('#FFFFFF').setFontWeight('bold').setWrap(true);

  var rowsB = [];
  for (var k = 0; k < outlets.length; k++) {
    var rb = rStartB + k;
    var rowB = [outlets[k]];
    for (var c = 0; c < cats.length; c++) {
      var catCol = colLetter(2 + c);
      rowB.push('=SUMIFS(Pembelanjaan!$G$2:$G, Pembelanjaan!$C$2:$C, $A' + rb + ', Pembelanjaan!$E$2:$E, ' + catCol + '$' + rHdrB + ')');
    }
    rowB.push('=SUM(B' + rb + ':' + lastCatCol + rb + ')');
    rowsB.push(rowB);
  }
  sheet.getRange(rStartB, 1, rowsB.length, numColsB).setValues(rowsB);
  sheet.getRange(rStartB, 2, rowsB.length, numColsB - 1).setNumberFormat('#,##0');

  var rEndB = rStartB + outlets.length - 1;
  var rTotalB = rEndB + 1;
  var totalRowB = ['TOTAL PER KATEGORI'];
  for (var colIdx = 2; colIdx <= numColsB; colIdx++) {
    var letter = colLetter(colIdx);
    totalRowB.push('=SUM(' + letter + rStartB + ':' + letter + rEndB + ')');
  }
  sheet.getRange(rTotalB, 1, 1, numColsB).setValues([totalRowB])
    .setBackground('#E8F0FA').setFontWeight('bold');
  sheet.getRange(rTotalB, 2, 1, numColsB - 1).setNumberFormat('#,##0');

  // --- SECTION C: REKAP ABSENSI, KASBON & PAYROLL ---
  var rTitleC = rTotalB + 2;
  var rHdrC = rTitleC + 1;
  var rStartC = rHdrC + 1;

  sheet.getRange(rTitleC, 1).setValue('C. REKAP ABSENSI, KASBON & PAYROLL')
    .setFontWeight('bold').setFontSize(11).setFontColor('#012669');
  sheet.getRange(rHdrC, 1, 1, 3).setValues([['Indikator', 'Nilai / Total', 'Keterangan']])
    .setBackground('#012669').setFontColor('#FFFFFF').setFontWeight('bold');

  var rowsC = [
    ['Total Hari/Shift Absensi Tercatat', '=COUNTA(Absensi!A2:A)', 'Jumlah baris log absensi kru'],
    ['Total Jam Kerja Karyawan (Jam)', '=SUM(Absensi!G2:G)', 'Akumulasi durasi kerja seluruh kru'],
    ['Total Pinjaman / Kasbon Diberikan (Rp)', '=SUM(Kasbon_Pinjaman!D2:D)', 'Total pinjaman & kasbon tercatat'],
    ['Total Cicilan / Potongan Terbayar (Rp)', '=SUM(Kasbon_Pinjaman!G2:G)', 'Total yang sudah dibayar / dipotong'],
    ['Sisa Pinjaman / Kasbon Aktif (Rp)', '=SUM(Kasbon_Pinjaman!H2:H)', 'Sisa hutang karyawan yang belum lunas'],
    ['Total Gaji Bersih / Payroll Dibayar (Rp)', '=SUM(Payroll!J2:J)', 'Total net pay pada log payroll'],
    ['Jumlah Slip Payroll Tercatat', '=COUNTA(Payroll!A2:A)', 'Total slip gaji yang sudah dibuat'],
  ];
  sheet.getRange(rStartC, 1, rowsC.length, 3).setValues(rowsC);
  sheet.getRange(rStartC, 2, rowsC.length, 1).setNumberFormat('#,##0');

  // --- SECTION D: REKAP PENGELUARAN LANGSUNG OWNER ---
  var ownerCats = Array.isArray(ownerCategories) && ownerCategories.length > 0
    ? ownerCategories
    : ['Belanja Bahan', 'Operasional', 'Perlengkapan', 'Lain-Lain'];
  var rTitleD = rStartC + rowsC.length + 1;
  var rHdrD = rTitleD + 1;
  var rStartD = rHdrD + 1;

  sheet.getRange(rTitleD, 1).setValue('D. REKAP PENGELUARAN LANGSUNG OWNER')
    .setFontWeight('bold').setFontSize(11).setFontColor('#012669');
  sheet.getRange(rHdrD, 1, 1, 3).setValues([['Kategori Pengeluaran Owner', 'Total (Rp)', 'Keterangan']])
    .setBackground('#012669').setFontColor('#FFFFFF').setFontWeight('bold');

  var rowsD = [];
  for (var d = 0; d < ownerCats.length; d++) {
    var rd = rStartD + d;
    rowsD.push([
      ownerCats[d],
      '=SUMIF(Pengeluaran_Owner!$B$2:$B, A' + rd + ', Pengeluaran_Owner!$F$2:$F)',
      ownerCats[d] === 'Belanja Bahan'
        ? 'Belanja bahan langsung oleh owner'
        : ownerCats[d] === 'Operasional'
          ? 'Listrik, WiFi, sewa, air, dll'
          : 'Pengeluaran owner kategori ' + ownerCats[d],
    ]);
  }
  sheet.getRange(rStartD, 1, rowsD.length, 3).setValues(rowsD);
  sheet.getRange(rStartD, 2, rowsD.length, 1).setNumberFormat('#,##0');

  var rEndD = rStartD + ownerCats.length - 1;
  var rTotalD = rEndD + 1;
  sheet.getRange(rTotalD, 1, 1, 3).setValues([[
    'TOTAL PENGELUARAN OWNER',
    '=SUM(B' + rStartD + ':B' + rEndD + ')',
    'Total seluruh pengeluaran langsung owner',
  ]]).setBackground('#E8F0FA').setFontWeight('bold');
  sheet.getRange(rTotalD, 2, 1, 1).setNumberFormat('#,##0');
}
