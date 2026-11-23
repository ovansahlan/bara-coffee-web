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
    ];

    var counts = {};
    for (var i = 0; i < tabNames.length; i++) {
      var name = tabNames[i];
      var rows = Array.isArray(tabs[name]) ? tabs[name] : [];
      var sheet = ss.getSheetByName(name);
      if (!sheet) {
        sheet = ss.insertSheet(name);
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

    // Perbarui daftar nama outlet di tab Ringkasan (baris 6..5+N) jika ada
    if (Array.isArray(payload.outlets) && payload.outlets.length > 0) {
      var summarySheet = ss.getSheetByName('Ringkasan');
      if (summarySheet) {
        var outlets = payload.outlets;
        var startRow = 6;
        for (var j = 0; j < outlets.length; j++) {
          var r = startRow + j;
          summarySheet.getRange(r, 1, 1, 9).setValues([[
            outlets[j],
            '=SUMIF(Transaksi_Harian!$B$2:$B, A' + r + ', Transaksi_Harian!$K$2:$K)',
            '=SUMIF(Transaksi_Harian!$B$2:$B, A' + r + ', Transaksi_Harian!$G$2:$G)',
            '=SUMIF(Transaksi_Harian!$B$2:$B, A' + r + ', Transaksi_Harian!$H$2:$H)',
            '=SUMIF(Transaksi_Harian!$B$2:$B, A' + r + ', Transaksi_Harian!$I$2:$I)',
            '=SUMIF(Transaksi_Harian!$B$2:$B, A' + r + ', Transaksi_Harian!$J$2:$J)',
            '=SUMIF(Pembelanjaan!$C$2:$C, A' + r + ', Pembelanjaan!$G$2:$G)',
            '=SUMIF(Setor_Owner_Bank!$C$2:$C, A' + r + ', Setor_Owner_Bank!$G$2:$G)',
            '=SUMIF(Transaksi_Harian!$B$2:$B, A' + r + ', Transaksi_Harian!$M$2:$M)',
          ]]);
        }
        var totalRow = startRow + outlets.length;
        var endRow = totalRow - 1;
        summarySheet.getRange(totalRow, 1, 1, 9).setValues([[
          'TOTAL SEMUA OUTLET',
          '=SUM(B' + startRow + ':B' + endRow + ')',
          '=SUM(C' + startRow + ':C' + endRow + ')',
          '=SUM(D' + startRow + ':D' + endRow + ')',
          '=SUM(E' + startRow + ':E' + endRow + ')',
          '=SUM(F' + startRow + ':F' + endRow + ')',
          '=SUM(G' + startRow + ':G' + endRow + ')',
          '=SUM(H' + startRow + ':H' + endRow + ')',
          '=SUM(I' + startRow + ':I' + endRow + ')',
        ]]);
      }
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
